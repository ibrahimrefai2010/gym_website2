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

// Activation on a caller-supplied connection, so a payment finalizer can
// commit payment + membership + invoice atomically. Locks the membership row.
async function activateOnConnection(connection, membershipId, adminId) {
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
}

async function activateMembership(membershipId, adminId) {
  ensureDatabase();
  return transaction((connection) => activateOnConnection(connection, membershipId, adminId));
}

// Online renewal: extends an active membership by the renewal plan's
// duration (+ bonus days), starting from the later of its current end date
// and today -- so renewing early never loses days and renewing after a
// lapse never back-dates. Locks the membership row; refuses anything that
// is no longer active (the caller then refunds/flags rather than silently
// extending a cancelled membership).
async function extendOnConnection(connection, membershipId, planId, adminId = null) {
  const [rows] = await connection.execute(
    "SELECT id, user_id, status, end_date FROM memberships WHERE id = ? LIMIT 1 FOR UPDATE",
    [membershipId]
  );
  const membership = rows[0];
  if (!membership || membership.status !== "active") {
    throw createHttpError(409, "This membership can no longer be renewed.", "MEMBERSHIP_NOT_RENEWABLE");
  }
  const [planRows] = await connection.execute(
    "SELECT duration_days, bonus_days FROM plans WHERE id = ? LIMIT 1",
    [planId]
  );
  if (!planRows[0]) {
    throw createHttpError(404, "Plan not found.", "PLAN_NOT_FOUND");
  }
  const today = dateOnly(new Date());
  const currentEnd = membership.end_date ? dateOnly(new Date(membership.end_date)) : today;
  const base = currentEnd > today ? currentEnd : today;
  const endDate = addDays(base, Number(planRows[0].duration_days || 0) + Number(planRows[0].bonus_days || 0));
  await connection.execute(
    "UPDATE memberships SET end_date = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?",
    [endDate, membershipId]
  );
  await connection
    .execute(
      `INSERT INTO notifications (user_id, type, title_ar, title_en, body_ar, body_en)
       VALUES (?, 'membership_activated', ?, ?, ?, ?)`,
      [
        membership.user_id,
        "تم تجديد عضويتك",
        "Your membership was renewed",
        `عضويتك مفعّلة حتى ${endDate}.`,
        `Your membership is now active until ${endDate}.`
      ]
    )
    .catch(() => {});
  return { id: membership.id, status: "active", endDate };
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


// ---- Admin membership actions (Part 2 §2.0.1) ------------------------------
// All three lock the membership row and write in one transaction.

const MAX_ACTION_DAYS = 365;

function actionDays(value, label) {
  const days = Number.parseInt(value, 10);
  if (!Number.isInteger(days) || days < 1 || days > MAX_ACTION_DAYS) {
    throw createHttpError(422, `${label} must be between 1 and ${MAX_ACTION_DAYS} days.`, "MEMBERSHIP_DAYS_INVALID");
  }
  return days;
}

function actionReason(value) {
  const reason = String(value || "").trim().slice(0, 255);
  if (reason.length < 3) {
    throw createHttpError(422, "A reason is required.", "MEMBERSHIP_REASON_REQUIRED");
  }
  return reason;
}

async function lockActiveMembership(connection, membershipId) {
  const [rows] = await connection.execute(
    "SELECT id, user_id, branch_id, status, end_date FROM memberships WHERE id = ? LIMIT 1 FOR UPDATE",
    [membershipId]
  );
  const membership = rows[0];
  if (!membership) {
    throw createHttpError(404, "Membership not found.", "MEMBERSHIP_NOT_FOUND");
  }
  if (membership.status !== "active" || !membership.end_date || dateOnly(new Date(membership.end_date)) < dateOnly(new Date())) {
    throw createHttpError(409, "Only an active membership can be changed this way.", "MEMBERSHIP_NOT_ACTIVE");
  }
  return membership;
}

// Freeze from today for `days`: the member cannot check in while frozen and
// the frozen days are added to the end date, so no paid days are lost.
async function freezeMembership(membershipId, { days, reason }, adminId) {
  ensureDatabase();
  const freezeDays = actionDays(days, "Freeze length");
  const why = actionReason(reason);
  return transaction(async (connection) => {
    const membership = await lockActiveMembership(connection, membershipId);
    const [open] = await connection.execute(
      "SELECT id FROM membership_freezes WHERE membership_id = ? AND status IN ('scheduled','active') AND deleted_at IS NULL LIMIT 1",
      [membershipId]
    );
    if (open[0]) {
      throw createHttpError(409, "This membership is already frozen.", "MEMBERSHIP_ALREADY_FROZEN");
    }
    const today = dateOnly(new Date());
    const endsOn = addDays(today, freezeDays - 1);
    const newEnd = addDays(dateOnly(new Date(membership.end_date)), freezeDays);
    await connection.execute(
      `INSERT INTO membership_freezes
        (branch_id, membership_id, user_id, freeze_type, reason, starts_on, ends_on, extension_days, status, approved_by, created_by, updated_by)
       VALUES (?, ?, ?, 'individual', ?, ?, ?, ?, 'active', ?, ?, ?)`,
      [membership.branch_id, membership.id, membership.user_id, why, today, endsOn, freezeDays, adminId, adminId, adminId]
    );
    await connection.execute("UPDATE memberships SET end_date = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?", [newEnd, adminId, membership.id]);
    return { id: membership.id, action: "freeze", frozenUntil: endsOn, endDate: newEnd };
  });
}

// End a freeze early: the unused frozen days come back off the end date.
async function unfreezeMembership(membershipId, adminId) {
  ensureDatabase();
  return transaction(async (connection) => {
    const membership = await lockActiveMembership(connection, membershipId);
    const [rows] = await connection.execute(
      "SELECT id, starts_on, ends_on FROM membership_freezes WHERE membership_id = ? AND status = 'active' AND deleted_at IS NULL LIMIT 1 FOR UPDATE",
      [membershipId]
    );
    const freeze = rows[0];
    if (!freeze) {
      throw createHttpError(409, "This membership is not frozen.", "MEMBERSHIP_NOT_FROZEN");
    }
    const today = dateOnly(new Date());
    const endsOn = dateOnly(new Date(freeze.ends_on));
    const unused = Math.max(0, Math.round((new Date(`${endsOn}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000));
    const newEnd = addDays(dateOnly(new Date(membership.end_date)), -unused);
    await connection.execute(
      `UPDATE membership_freezes SET status = 'completed', ends_on = ?, extension_days = GREATEST(extension_days - ?, 0),
         updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?`,
      [addDays(today, -1) < dateOnly(new Date(freeze.starts_on)) ? dateOnly(new Date(freeze.starts_on)) : addDays(today, -1), unused, adminId, freeze.id]
    );
    await connection.execute("UPDATE memberships SET end_date = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?", [newEnd, adminId, membership.id]);
    return { id: membership.id, action: "unfreeze", endDate: newEnd, returnedDays: unused };
  });
}

// Goodwill / compensation extension with a mandatory reason.
async function extendMembership(membershipId, { days, reason }, adminId) {
  ensureDatabase();
  const extra = actionDays(days, "Extension");
  const why = actionReason(reason);
  return transaction(async (connection) => {
    const membership = await lockActiveMembership(connection, membershipId);
    const newEnd = addDays(dateOnly(new Date(membership.end_date)), extra);
    await connection.execute("UPDATE memberships SET end_date = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?", [newEnd, adminId, membership.id]);
    await connection.execute(
      "INSERT INTO customer_notes (user_id, note, visibility, created_by, updated_by) VALUES (?, ?, 'internal', ?, ?)",
      [membership.user_id, `Membership extended by ${extra} day(s): ${why}`, adminId, adminId]
    );
    return { id: membership.id, action: "extend", days: extra, endDate: newEnd, reason: why };
  });
}

// Completes freezes whose window has passed (daily cron).
async function completeEndedFreezes() {
  ensureDatabase();
  const result = await query(
    "UPDATE membership_freezes SET status = 'completed', updated_at = UTC_TIMESTAMP() WHERE status = 'active' AND ends_on < UTC_DATE() AND deleted_at IS NULL"
  );
  return result.affectedRows || 0;
}

async function activeFreeze(membershipId) {
  ensureDatabase();
  const rows = await query(
    `SELECT id, starts_on, ends_on, reason FROM membership_freezes
     WHERE membership_id = ? AND status = 'active' AND deleted_at IS NULL AND UTC_DATE() BETWEEN starts_on AND ends_on
     LIMIT 1`,
    [membershipId]
  );
  return rows[0] || null;
}

async function updateMembership(id, action, payload = {}, adminId = null) {
  ensureDatabase();
  if (action === "freeze") return freezeMembership(id, payload, adminId);
  if (action === "unfreeze") return unfreezeMembership(id, adminId);
  if (action === "extend") return extendMembership(id, payload, adminId);
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
  activeFreeze,
  completeEndedFreezes,
  extendMembership,
  freezeMembership,
  unfreezeMembership,
  activateMembership,
  activateOnConnection,
  extendOnConnection,
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
