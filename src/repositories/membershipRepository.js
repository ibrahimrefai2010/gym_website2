const { hasDatabaseConfig, query, transaction } = require("../config/database");
const planRepository = require("./planRepository");
const settingsRepository = require("./settingsRepository");
const { createHttpError } = require("../utils/httpError");

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days));
  return dateOnly(date);
}

async function expireMemberships() {
  ensureDatabase();
  await query("UPDATE memberships SET status = 'expired', updated_at = UTC_TIMESTAMP() WHERE end_date < UTC_DATE() AND status = 'active'");
}

async function listMemberships() {
  ensureDatabase();
  await expireMemberships();
  const rows = await query(
    `SELECT m.id, u.full_name AS member, p.name_en AS plan, m.start_date, m.end_date,
      DATEDIFF(m.end_date, UTC_DATE()) AS remaining_days, m.status,
      COALESCE(pay.status, 'pending') AS payment_status
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     JOIN plans p ON p.id = m.plan_id
     LEFT JOIN (
       SELECT membership_id, MAX(id) AS latest_payment_id
       FROM payments
       WHERE membership_id IS NOT NULL
       GROUP BY membership_id
     ) latest_pay ON latest_pay.membership_id = m.id
     LEFT JOIN payments pay ON pay.id = latest_pay.latest_payment_id
     ORDER BY COALESCE(m.end_date, m.created_at) DESC
     LIMIT 100`
  );

  return rows.map((row) => ({
    id: row.id,
    member: row.member,
    plan: row.plan,
    startDate: row.start_date,
    endDate: row.end_date,
    remainingDays: row.remaining_days,
    status: row.status,
    paymentStatus: row.payment_status
  }));
}

async function getMine(userId) {
  ensureDatabase();
  await expireMemberships();
  const rows = await query(
    `SELECT m.id, m.status, m.start_date, m.end_date, p.name_en, p.name_ar
     FROM memberships m
     JOIN plans p ON p.id = m.plan_id
     WHERE m.user_id = ?
     ORDER BY COALESCE(m.end_date, m.created_at) DESC, m.id DESC
     LIMIT 1`,
    [userId]
  );

  return rows[0] || null;
}

async function activeMembership(userId) {
  ensureDatabase();
  const rows = await query(
    "SELECT id FROM memberships WHERE user_id = ? AND status = 'active' LIMIT 1",
    [userId]
  );
  return rows[0] || null;
}

async function buy({ userId, planId, paymentMethod = "manual", provider = "manual" }) {
  ensureDatabase();
  const plan = await planRepository.getPlan(planId);
  if (!plan || !plan.isActive) {
    throw createHttpError(404, "Plan not found.", "PLAN_NOT_FOUND");
  }

  if (await activeMembership(userId)) {
    throw createHttpError(409, "You already have an active membership. Please contact the gym to renew.", "ACTIVE_MEMBERSHIP_EXISTS");
  }

  return transaction(async (connection) => {
    const [membershipResult] = await connection.execute(
      `INSERT INTO memberships (user_id, plan_id, status)
       VALUES (?, ?, 'pending')`,
      [userId, planId]
    );

    const [paymentResult] = await connection.execute(
      `INSERT INTO payments (user_id, membership_id, provider, payment_method, amount, currency, status)
       VALUES (?, ?, ?, ?, ?, 'SAR', 'pending')`,
      [userId, membershipResult.insertId, provider, paymentMethod, plan.price]
    );

    return {
      membership: {
        id: membershipResult.insertId,
        status: "pending",
        plan
      },
      payment: {
        id: paymentResult.insertId,
        status: "pending",
        amount: `SAR ${Number(plan.price).toFixed(2)}`
      }
    };
  });
}

async function activationDates(connection, membershipId, userId, planId) {
  const [planRows] = await connection.execute(
    "SELECT duration_days, bonus_days FROM plans WHERE id = ? AND deleted_at IS NULL LIMIT 1",
    [planId]
  );
  const plan = planRows[0];
  if (!plan) {
    throw createHttpError(404, "Plan not found.", "PLAN_NOT_FOUND");
  }

  const [previousRows] = await connection.execute(
    `SELECT end_date
     FROM memberships
     WHERE user_id = ? AND id <> ? AND end_date IS NOT NULL
     ORDER BY end_date DESC
     LIMIT 1`,
    [userId, membershipId]
  );

  const today = dateOnly(new Date());
  const nextAvailableDate = previousRows[0]?.end_date ? addDays(dateOnly(new Date(previousRows[0].end_date)), 1) : today;
  const startDate = nextAvailableDate > today ? nextAvailableDate : today;
  const endDate = addDays(startDate, Number(plan.duration_days || 0) + Number(plan.bonus_days || 0));
  return { startDate, endDate };
}

async function activateMembership(membershipId, adminId) {
  ensureDatabase();
  return transaction(async (connection) => {
    const [rows] = await connection.execute(
      `SELECT id, user_id, plan_id, status
       FROM memberships
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [membershipId]
    );
    const membership = rows[0];
    if (!membership) {
      throw createHttpError(404, "Membership not found.", "MEMBERSHIP_NOT_FOUND");
    }
    if (membership.status === "cancelled" || membership.status === "expired") {
      throw createHttpError(409, "This membership cannot be activated.", "MEMBERSHIP_NOT_ACTIVATABLE");
    }

    const [activeRows] = await connection.execute(
      "SELECT id FROM memberships WHERE user_id = ? AND status = 'active' AND id <> ? LIMIT 1",
      [membership.user_id, membership.id]
    );
    if (activeRows[0]) {
      throw createHttpError(409, "User already has an active membership.", "ACTIVE_MEMBERSHIP_EXISTS");
    }

    const { startDate, endDate } = await activationDates(connection, membership.id, membership.user_id, membership.plan_id);
    await connection.execute(
      `UPDATE memberships
       SET status = 'active', start_date = ?, end_date = ?, activated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [startDate, endDate, adminId || null, membership.id]
    );

    await connection
      .execute(
        `INSERT INTO notifications (user_id, type, title_ar, title_en, body_ar, body_en)
         VALUES (?, 'membership_activated', ?, ?, ?, ?)`,
        [
          membership.user_id,
          "تم تفعيل عضويتك",
          "Your membership is active",
          `عضويتك مفعّلة حتى ${endDate}.`,
          `Your membership is active until ${endDate}.`
        ]
      )
      .catch(() => {});

    return { id: membership.id, status: "active", startDate, endDate };
  });
}

async function maybeAutoActivate(membershipId, adminId = null) {
  // Resolve the membership's own branch (via its user) rather than requiring
  // callers (paymentService/paymentRepository) to pass one -- keeps this a
  // drop-in fix without touching payment code, which is out of scope here.
  let branchId = 1;
  try {
    const rows = await query(
      `SELECT u.branch_id FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.id = ? LIMIT 1`,
      [membershipId]
    );
    branchId = rows[0]?.branch_id || 1;
  } catch (_error) {
    branchId = 1;
  }

  const mode = await settingsRepository.getSetting("membership_activation_mode", "manual", branchId);
  if (mode !== "auto") {
    return null;
  }
  return activateMembership(membershipId, adminId);
}

async function updateMembership(id, action) {
  ensureDatabase();
  if (action !== "cancel") {
    throw createHttpError(400, "Unsupported membership action.", "MEMBERSHIP_ACTION_INVALID");
  }

  const result = await query(
    `UPDATE memberships
     SET status = 'cancelled', cancelled_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
     WHERE id = ? AND status IN ('pending','active')`,
    [id]
  );
  if (result.affectedRows === 0) {
    throw createHttpError(404, "Active or pending membership not found.", "MEMBERSHIP_NOT_FOUND");
  }
  return { id, action, updated: true };
}

module.exports = {
  activateMembership,
  buy,
  expireMemberships,
  getMine,
  listMemberships,
  maybeAutoActivate,
  updateMembership
};
