const { hasDatabaseConfig, query } = require("../config/database");
const { createHttpError } = require("../utils/httpError");
const { hashPassword, verifyPassword } = require("../utils/hash");
const { positiveInteger } = require("../utils/validator");

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

function publicUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    memberCode: row.member_code || null,
    role: "member",
    type: "user",
    status: row.status
  };
}

async function findForLogin(identifier) {
  ensureDatabase();
  const normalized = String(identifier || "").trim().toLowerCase();
  const phone = String(identifier || "").replace(/[^\d+]/g, "");
  const rows = await query(
    `SELECT id, full_name, email, phone, member_code, status, password_hash
     FROM users
     WHERE deleted_at IS NULL AND (LOWER(email) = ? OR REPLACE(REPLACE(phone, '+', ''), ' ', '') = REPLACE(?, '+', ''))
     LIMIT 1`,
    [normalized, phone]
  );
  return rows[0] || null;
}

async function findByEmailOrPhone(identifier) {
  ensureDatabase();
  const normalized = String(identifier || "").trim().toLowerCase();
  const phone = String(identifier || "").replace(/[^\d+]/g, "");
  const rows = await query(
    `SELECT id, full_name, email, phone, member_code, status, password_hash
     FROM users
     WHERE deleted_at IS NULL AND (LOWER(email) = ? OR REPLACE(REPLACE(phone, '+', ''), ' ', '') = REPLACE(?, '+', ''))
     LIMIT 1`,
    [normalized, phone]
  );
  return rows[0] || null;
}

async function findById(id, options = {}) {
  ensureDatabase();
  const rows = await query(
    `SELECT id, full_name, email, phone, member_code, status${options.includePassword ? ", password_hash" : ""}
     FROM users
     WHERE id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function createUser(payload) {
  ensureDatabase();
  const passwordHash = await hashPassword(payload.password);
  try {
    const result = await query(
      `INSERT INTO users (full_name, email, phone, password_hash, status)
       VALUES (?, ?, ?, ?, 'active')`,
      [payload.fullName, payload.email, payload.phone, passwordHash]
    );
    await query(
      `UPDATE users
       SET member_code = CONCAT('MFC-', LPAD(id, 6, '0')),
           card_token = REPLACE(UUID(), '-', '')
       WHERE id = ? AND member_code IS NULL`,
      [result.insertId]
    );
    return findById(result.insertId, { includePassword: true });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return null;
    }
    throw error;
  }
}

async function updatePassword(userId, password) {
  ensureDatabase();
  await query(
    "UPDATE users SET password_hash = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND deleted_at IS NULL",
    [await hashPassword(password), userId]
  );
}

async function getDashboard(userId) {
  ensureDatabase();
  const [userRows, membershipRows, paymentRows] = await Promise.all([
    query(
      `SELECT id, full_name, email, phone, status
       FROM users
       WHERE id = ? AND deleted_at IS NULL
       LIMIT 1`,
      [userId]
    ),
    query(
      `SELECT m.id, m.status, m.start_date, m.end_date, p.name_en, p.name_ar, p.price
       FROM memberships m
       JOIN plans p ON p.id = m.plan_id
       WHERE m.user_id = ?
       ORDER BY COALESCE(m.end_date, m.created_at) DESC, m.id DESC
       LIMIT 1`,
      [userId]
    ),
    query(
      `SELECT id, amount, currency, status, completed_at, created_at
       FROM payments
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 8`,
      [userId]
    )
  ]);

  const membership = membershipRows[0]
    ? {
        id: membershipRows[0].id,
        status: membershipRows[0].status,
        plan: { en: membershipRows[0].name_en, ar: membershipRows[0].name_ar },
        startDate: membershipRows[0].start_date,
        endDate: membershipRows[0].end_date,
        expiresAt: membershipRows[0].end_date,
        renewalAmount: `SAR ${Number(membershipRows[0].price || 0).toFixed(2)}`
      }
    : null;

  return {
    user: publicUser(userRows[0]),
    membership,
    payments: paymentRows.map((payment) => ({
      id: payment.id,
      amount: `${payment.currency} ${Number(payment.amount).toFixed(2)}`,
      status: payment.status,
      date: payment.completed_at || payment.created_at
    }))
  };
}

async function listUsers({ page = 1, pageSize = 10, search = "", status = "", membership = "" } = {}) {
  ensureDatabase();
  const where = ["u.deleted_at IS NULL"];
  const params = [];

  if (search) {
    where.push("(u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    where.push("u.status = ?");
    params.push(status);
  }
  if (membership) {
    where.push("p.name_en = ?");
    params.push(membership);
  }

  const limit = positiveInteger(pageSize, 10, 100);
  const currentPage = positiveInteger(page, 1, 1000000);
  const offset = (currentPage - 1) * limit;
  const rows = await query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at,
      p.name_en AS membership
     FROM users u
     LEFT JOIN memberships m ON m.user_id = u.id AND m.status = 'active'
     LEFT JOIN plans p ON p.id = m.plan_id
     WHERE ${where.join(" AND ")}
     ORDER BY u.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const totalRows = await query(
    `SELECT COUNT(*) AS total
     FROM users u
     LEFT JOIN memberships m ON m.user_id = u.id AND m.status = 'active'
     LEFT JOIN plans p ON p.id = m.plan_id
     WHERE ${where.join(" AND ")}`,
    params
  );

  return {
    items: rows.map((user) => ({
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      phone: user.phone,
      status: user.status,
      membership: user.membership || "None",
      registrationDate: user.created_at
    })),
    pagination: {
      page: currentPage,
      pageSize: limit,
      total: Number(totalRows[0]?.total || 0)
    }
  };
}

async function exportMembers({ limit = 10000 } = {}) {
  ensureDatabase();
  const cap = Math.min(Math.max(Number.parseInt(limit, 10) || 10000, 1), 50000);
  return query(
    `SELECT u.id, u.member_code, u.full_name, u.email, u.phone,
       u.status AS account_status, u.created_at,
       lm.status AS membership_status, lm.start_date, lm.end_date,
       lm.plan_en, lm.plan_ar
     FROM users u
     LEFT JOIN (
       SELECT ranked.user_id, ranked.status, ranked.start_date, ranked.end_date,
              pl.name_en AS plan_en, pl.name_ar AS plan_ar
       FROM (
         SELECT mm.user_id, mm.status, mm.start_date, mm.end_date, mm.plan_id,
                ROW_NUMBER() OVER (
                  PARTITION BY mm.user_id
                  ORDER BY COALESCE(mm.end_date, mm.created_at) DESC, mm.id DESC
                ) AS rn
         FROM memberships mm
       ) ranked
       JOIN plans pl ON pl.id = ranked.plan_id
       WHERE ranked.rn = 1
     ) lm ON lm.user_id = u.id
     WHERE u.deleted_at IS NULL
     ORDER BY u.created_at DESC
     LIMIT ${cap}`
  );
}

async function getUserDetails(id) {
  ensureDatabase();
  const [userRows, dashboard, tokens] = await Promise.all([
    query("SELECT id, full_name, email, phone, status, created_at FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1", [id]),
    getDashboard(id),
    query(
      `SELECT ip_address, user_agent, created_at, expires_at, revoked_at
       FROM refresh_tokens
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 10`,
      [id]
    )
  ]);

  return {
    user: publicUser(userRows[0]),
    membership: dashboard.membership,
    payments: dashboard.payments,
    loginHistory: tokens,
    adminNotes: []
  };
}

async function updateProfile(userId, payload) {
  ensureDatabase();
  const result = await query(
    `UPDATE users
     SET full_name = COALESCE(?, full_name), phone = COALESCE(?, phone), updated_at = UTC_TIMESTAMP()
     WHERE id = ? AND deleted_at IS NULL`,
    [payload.fullName || null, payload.phone || null, userId]
  );
  if (result.affectedRows === 0) {
    throw createHttpError(404, "User not found.", "USER_NOT_FOUND");
  }

  return publicUser(await findById(userId));
}

async function changePassword(userId, currentPassword, nextPassword) {
  ensureDatabase();
  const rows = await query(
    "SELECT password_hash FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1",
    [userId]
  );
  if (!rows[0]) {
    return false;
  }

  const isValid = await verifyPassword(currentPassword, rows[0].password_hash);
  if (!isValid) {
    return false;
  }

  await updatePassword(userId, nextPassword);

  return true;
}

module.exports = {
  changePassword,
  createUser,
  findByEmailOrPhone,
  findById,
  findForLogin,
  getDashboard,
  exportMembers,
  getUserDetails,
  listUsers,
  publicUser,
  updatePassword,
  updateProfile
};
