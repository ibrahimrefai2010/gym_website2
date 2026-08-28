const { hasDatabaseConfig, query } = require("../config/database");
const { createHttpError } = require("../utils/httpError");
const { assertEnum, positiveInteger } = require("../utils/validator");

const ATTENDANCE_METHODS = ["manual", "qr", "mobile", "kiosk", "import"];

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
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const totalRows = await query(`SELECT COUNT(*) AS total FROM attendance_logs a WHERE ${where.join(" AND ")}`, params);
  return {
    items: rows,
    pagination: { page: currentPage, pageSize: limit, total: Number(totalRows[0]?.total || 0) }
  };
}

async function checkIn(payload, adminId = null) {
  ensureDatabase();
  const method = payload.method || "manual";
  assertEnum(method, ATTENDANCE_METHODS, "Attendance method");
  const result = await query(
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

async function checkOut(id, adminId = null) {
  ensureDatabase();
  const result = await query(
    `UPDATE attendance_logs
     SET check_out_at = UTC_TIMESTAMP(), status = 'checked_out', updated_by = ?, updated_at = UTC_TIMESTAMP()
     WHERE id = ? AND deleted_at IS NULL AND status = 'checked_in'`,
    [adminId, id]
  );
  if (result.affectedRows === 0) {
    throw createHttpError(404, "Open attendance record not found.", "ATTENDANCE_NOT_FOUND");
  }
  return { id: Number(id), status: "checked_out" };
}

module.exports = {
  checkIn,
  checkOut,
  listAttendance
};
