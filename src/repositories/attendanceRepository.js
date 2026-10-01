const { hasDatabaseConfig, query } = require("../config/database");
const { createHttpError } = require("../utils/httpError");
const { assertEnum, positiveInteger } = require("../utils/validator");

const ATTENDANCE_METHODS = ["manual", "qr", "mobile", "kiosk", "import"];

// check_in_at is stored in UTC; reception days and peak hours are bucketed in
// the business timezone (Asia/Riyadh, env.timezone). Saudi Arabia has no DST,
// so a fixed numeric offset is exact and needs no MySQL tz tables.
const LOCAL_CHECK_IN = "CONVERT_TZ(a.check_in_at, '+00:00', '+03:00')";
const LOCAL_TODAY = "DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+03:00'))";

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

async function listAttendance({ page = 1, pageSize = 25, branchId = "", userId = "", status = "", dateFrom = "", dateTo = "" } = {}) {
  ensureDatabase();
  const where = ["a.deleted_at IS NULL"];
  const params = [];
  if (branchId) {
    where.push("a.branch_id = ?");
    params.push(branchId);
  }
  if (userId) {
    where.push("a.user_id = ?");
    params.push(userId);
  }
  if (status) {
    where.push("a.status = ?");
    params.push(status);
  }
  if (dateFrom) {
    where.push("a.check_in_at >= ?");
    params.push(`${dateFrom} 00:00:00`);
  }
  if (dateTo) {
    where.push("a.check_in_at <= ?");
    params.push(`${dateTo} 23:59:59`);
  }
  // Bounded server-computed integers, interpolated: mysql2 prepared
  // statements reject LIMIT ? (ER_WRONG_ARGUMENTS).
  const limit = positiveInteger(pageSize, 25, 100);
  const currentPage = positiveInteger(page, 1, 1000000);
  const offset = (currentPage - 1) * limit;
  const rows = await query(
    `SELECT a.*, u.full_name AS customer, b.name_en AS branch
     FROM attendance_logs a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN branches b ON b.id = a.branch_id
     WHERE ${where.join(" AND ")}
     ORDER BY a.check_in_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const totalRows = await query(`SELECT COUNT(*) AS total FROM attendance_logs a WHERE ${where.join(" AND ")}`, params);
  return {
    items: rows,
    pagination: { page: currentPage, pageSize: limit, total: Number(totalRows[0]?.total || 0) }
  };
}

// connection: optional transaction connection (see checkinService's
// verifyAndCheckIn) -- defaults to the shared pool.
async function checkIn(payload, adminId = null, connection = null) {
  ensureDatabase();
  const method = payload.method || "manual";
  assertEnum(method, ATTENDANCE_METHODS, "Attendance method");
  const run = connection ? async (sql, params) => (await connection.execute(sql, params))[0] : query;
  const result = await run(
    `INSERT INTO attendance_logs
      (branch_id, user_id, membership_id, check_in_at, method, status, recorded_by,
       notes, created_by, updated_by)
     VALUES (?, ?, ?, COALESCE(?, UTC_TIMESTAMP()), ?, 'checked_in', ?, ?, ?, ?)`,
    [
      payload.branchId || 1,
      payload.userId,
      payload.membershipId || null,
      payload.checkInAt || null,
      method,
      adminId,
      payload.notes || "",
      adminId,
      adminId
    ]
  );
  return { id: result.insertId, status: "checked_in" };
}

// An open (not checked-out) check-in for this user within the last
// `minutes` -- lets reception treat a re-scan / second desk scanning the
// same member as the same visit instead of a second attendance row.
async function findRecentOpenCheckIn(userId, minutes, connection) {
  const [rows] = await connection.execute(
    `SELECT id, check_in_at FROM attendance_logs
     WHERE user_id = ? AND status = 'checked_in' AND deleted_at IS NULL
       AND check_in_at >= UTC_TIMESTAMP() - INTERVAL ? MINUTE
     ORDER BY check_in_at DESC
     LIMIT 1`,
    [userId, minutes]
  );
  return rows[0] || null;
}

// branchId: the caller's server-derived branch -- a row from another branch
// gets the same 404 as a missing one (no existence leak across branches).
async function checkOut(id, adminId = null, branchId = null) {
  ensureDatabase();
  const result = await query(
    `UPDATE attendance_logs
     SET check_out_at = UTC_TIMESTAMP(), status = 'checked_out', updated_by = ?, updated_at = UTC_TIMESTAMP()
     WHERE id = ? AND deleted_at IS NULL AND status = 'checked_in' AND branch_id = ?`,
    [adminId, id, branchId]
  );
  if (result.affectedRows === 0) {
    throw createHttpError(404, "Open attendance record not found.", "ATTENDANCE_NOT_FOUND");
  }
  return { id: Number(id), status: "checked_out" };
}

// Reception "today's log" widget -- branchId is required (same "empty means
// no rows" convention as taskRepository/coachRepository), date (YYYY-MM-DD)
// defaults to today, both in Riyadh local time (see LOCAL_CHECK_IN).
async function dailyLog({ branchId = "", date = "" } = {}) {
  ensureDatabase();
  if (!branchId) {
    return [];
  }
  const where = ["a.deleted_at IS NULL", "a.branch_id = ?"];
  const params = [branchId];
  if (date) {
    where.push(`DATE(${LOCAL_CHECK_IN}) = ?`);
    params.push(date);
  } else {
    where.push(`DATE(${LOCAL_CHECK_IN}) = ${LOCAL_TODAY}`);
  }
  return query(
    `SELECT a.id, a.user_id, u.full_name AS customer, u.member_code, a.check_in_at, a.check_out_at,
       a.method, a.status
     FROM attendance_logs a
     JOIN users u ON u.id = a.user_id
     WHERE ${where.join(" AND ")}
     ORDER BY a.check_in_at DESC`,
    params
  );
}

// Day-of-week x hour-of-day peak-hours grid for a branch (Riyadh local
// time), over the trailing `days` window (default 90). DAYOFWEEK() is
// MySQL's own 1=Sunday..7=Saturday numbering -- returned as-is; the admin UI
// maps it to display labels.
async function heatmap({ branchId = "", days = 90 } = {}) {
  ensureDatabase();
  if (!branchId) {
    return [];
  }
  const windowDays = positiveInteger(days, 90, 365);
  return query(
    `SELECT DAYOFWEEK(${LOCAL_CHECK_IN}) AS day_of_week, HOUR(${LOCAL_CHECK_IN}) AS hour_of_day, COUNT(*) AS total
     FROM attendance_logs a
     WHERE a.deleted_at IS NULL AND a.branch_id = ? AND a.check_in_at >= UTC_TIMESTAMP() - INTERVAL ? DAY
     GROUP BY day_of_week, hour_of_day`,
    [branchId, windowDays]
  );
}

// Daily/weekly/monthly check-in totals for a branch's reception dashboard
// (Riyadh local days; week/month are the trailing 7/30 days incl. today).
async function summary({ branchId = "" } = {}) {
  ensureDatabase();
  if (!branchId) {
    return { today: 0, week: 0, month: 0 };
  }
  const rows = await query(
    `SELECT
       SUM(CASE WHEN DATE(${LOCAL_CHECK_IN}) = ${LOCAL_TODAY} THEN 1 ELSE 0 END) AS today,
       SUM(CASE WHEN DATE(${LOCAL_CHECK_IN}) >= ${LOCAL_TODAY} - INTERVAL 6 DAY THEN 1 ELSE 0 END) AS week,
       SUM(CASE WHEN DATE(${LOCAL_CHECK_IN}) >= ${LOCAL_TODAY} - INTERVAL 29 DAY THEN 1 ELSE 0 END) AS month
     FROM attendance_logs a
     WHERE a.deleted_at IS NULL AND a.branch_id = ?`,
    [branchId]
  );
  const row = rows[0] || {};
  return {
    today: Number(row.today || 0),
    week: Number(row.week || 0),
    month: Number(row.month || 0)
  };
}

module.exports = {
  checkIn,
  checkOut,
  dailyLog,
  findRecentOpenCheckIn,
  heatmap,
  listAttendance,
  summary
};
