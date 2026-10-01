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

async function listMemberships(branchId = null) {
  ensureDatabase();
  await expireMemberships();
  // memberships has its own branch_id column (not derived via a join to
  // users) -- same authoritative-column pattern invoiceRepository.listInvoices
  // uses for i.branch_id.
  const where = branchId ? "WHERE m.branch_id = ?" : "";
  const params = branchId ? [branchId] : [];
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
     ${where}
     ORDER BY COALESCE(m.end_date, m.created_at) DESC
     LIMIT 100`,
    params
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

// For by-id ownership checks (membershipController.activate/cancel/action) --
// memberships carry their own branch_id column (see listMemberships above),
// so this is a direct lookup, not a join through users.
async function getMembership(id) {
  ensureDatabase();
  const rows = await query("SELECT id, user_id, branch_id, status FROM memberships WHERE id = ? LIMIT 1", [id]);
  return rows[0] || null;
}

// Shared "is this user's membership active" lookup -- used by buy() to
// reject a duplicate purchase, and reused as-is by checkinService's
// verifyAndCheckIn (see src/services/checkinService.js) rather than that
// service reinventing this query. status = 'active' AND a not-yet-passed
// end_date, not status alone -- the 'active' -> 'expired' flip only happens
// when expireMemberships() runs (cron / another membership read), so a
// membership can sit "active" in the DB past its own end_date until that
// next runs. Checking end_date here too means a reception check-in never
// treats a stale, un-expired-yet row as a valid entry.
async function activeMembership(userId) {
  ensureDatabase();
  const rows = await query(
    `SELECT m.id, m.status, m.end_date, p.name_en AS plan_name_en, p.name_ar AS plan_name_ar
     FROM memberships m
     JOIN plans p ON p.id = m.plan_id
     WHERE m.user_id = ? AND m.status = 'active' AND (m.end_date IS NULL OR m.end_date >= UTC_DATE())
     ORDER BY COALESCE(m.end_date, m.created_at) DESC, m.id DESC
     LIMIT 1`,
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

  // A plan belongs to exactly one branch (NOT NULL branch_id, see
  // 202609180001_women_branch.up.sql). Without this check a user could end
  // up with a membership tied to a plan from a branch they don't belong to.
  const userRows = await query(
    "SELECT branch_id FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1",
    [userId]
  );
  const userBranchId = userRows[0]?.branch_id != null ? Number(userRows[0].branch_id) : null;
  if (userBranchId == null) {
    throw createHttpError(404, "User not found.", "USER_NOT_FOUND");
  }
  if (Number(plan.branchId) !== userBranchId) {
    throw createHttpError(409, "This plan is not available for your branch.", "PLAN_BRANCH_MISMATCH");
  }

  if (await activeMembership(userId)) {
    throw createHttpError(409, "You already have an active membership. Please contact the gym to renew.", "ACTIVE_MEMBERSHIP_EXISTS");
  }

  return transaction(async (connection) => {
    // branch_id is set explicitly from the user's own branch rather than
    // relying on the column default (DEFAULT 1), so a Women's-branch
    // member's membership row is never silently tagged Main.
    const [membershipResult] = await connection.execute(
      `INSERT INTO memberships (user_id, plan_id, branch_id, status)
       VALUES (?, ?, ?, 'pending')`,
      [userId, planId, userBranchId]
    );

    // branch_id explicit here too (same reasoning as the membership insert
    // above) -- without it this row would silently fall back to the
    // payments.branch_id column default (Main), which would make a
    // Women's-branch payment invisible to by-branch ownership checks
    // (assertBranchOwnership / paymentController.complete) and to any
    // branch-filtered payments list.
    const [paymentResult] = await connection.execute(
      `INSERT INTO payments (user_id, membership_id, branch_id, provider, payment_method, amount, currency, status)
       VALUES (?, ?, ?, ?, ?, ?, 'SAR', 'pending')`,
      [userId, membershipResult.insertId, userBranchId, provider, paymentMethod, plan.price]
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

// Latest non-pending membership regardless of status -- lets check-in tell
// "expired" apart from "never had one" on the rejection screen.
async function latestMembership(userId) {
  ensureDatabase();
  const rows = await query(
    `SELECT id, status, end_date FROM memberships
     WHERE user_id = ? AND status <> 'pending'
     ORDER BY COALESCE(end_date, created_at) DESC, id DESC
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

module.exports = {
  activateMembership,
  activeMembership,
  buy,
  expireMemberships,
  getMembership,
  latestMembership,
  getMine,
  listMemberships,
  maybeAutoActivate,
  updateMembership
};
