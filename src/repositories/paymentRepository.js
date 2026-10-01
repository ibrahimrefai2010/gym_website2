const crypto = require("crypto");
const { hasDatabaseConfig, query, transaction } = require("../config/database");
const { createHttpError } = require("../utils/httpError");
const membershipRepository = require("./membershipRepository");

const processedEvents = new Set();

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

function eventHash(payload) {
  return crypto.createHash("sha256").update(String(payload || "")).digest("hex");
}

async function hasProcessedEvent(provider, eventId) {
  if (!hasDatabaseConfig()) {
    return processedEvents.has(`${provider}:${eventId}`);
  }

  const rows = await query(
    "SELECT id FROM payment_events WHERE provider = ? AND event_id = ? LIMIT 1",
    [provider, eventId]
  );
  return Boolean(rows[0]);
}

async function recordEvent({ provider, eventId, eventType, payload }) {
  ensureDatabase();
  await query(
    `INSERT INTO payment_events (provider, event_id, event_type, payload_hash, raw_payload)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE event_type = VALUES(event_type)`,
    [provider, eventId, eventType, eventHash(payload), payload]
  );
  return { id: eventId };
}

async function createPayment(payload) {
  ensureDatabase();
  const result = await query(
    `INSERT INTO payments
      (user_id, membership_id, provider, payment_method, provider_reference, transaction_id,
       amount, currency, status, completed_at, raw_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.userId,
      payload.membershipId || null,
      payload.provider || "manual",
      payload.paymentMethod || payload.provider || "manual",
      payload.providerReference || payload.transactionId || null,
      payload.transactionId || null,
      payload.amount,
      payload.currency || "SAR",
      payload.status || "pending",
      payload.completedAt || null,
      payload.rawPayload ? JSON.stringify(payload.rawPayload) : null
    ]
  );

  return { id: result.insertId, status: payload.status || "pending" };
}

// For by-id ownership checks (paymentController.complete). Derived via the
// paying user's own branch_id rather than trusting payments.branch_id
// directly -- membershipRepository.maybeAutoActivate uses the same
// via-the-user derivation for the identical reason (a payment's branch_id
// column isn't reliably populated by every insert path, e.g. the Stripe
// checkout flow in paymentService.createCheckoutSession/createIntent never
// sets it; out of scope to change that provider-integration code here).
async function getPaymentOwnerBranch(paymentId) {
  ensureDatabase();
  const rows = await query(
    `SELECT p.id, u.branch_id
     FROM payments p
     JOIN users u ON u.id = p.user_id
     WHERE p.id = ?
     LIMIT 1`,
    [paymentId]
  );
  return rows[0] || null;
}

async function completePayment(paymentId, adminId) {
  ensureDatabase();
  const rows = await query(
    `SELECT id, user_id, membership_id, amount, currency, status
     FROM payments
     WHERE id = ?
     LIMIT 1`,
    [paymentId]
  );
  const payment = rows[0];
  if (!payment) {
    throw createHttpError(404, "Payment not found.", "PAYMENT_NOT_FOUND");
  }
  if (payment.status === "completed") {
    return { id: payment.id, status: "completed", alreadyCompleted: true };
  }
  if (payment.status !== "pending") {
    throw createHttpError(409, "Only pending payments can be completed.", "PAYMENT_NOT_PENDING");
  }

  const result = await query(
    `UPDATE payments
     SET status = 'completed', completed_at = UTC_TIMESTAMP(), completed_by = ?, updated_at = UTC_TIMESTAMP()
     WHERE id = ? AND status = 'pending'`,
    [adminId, paymentId]
  );
  if (result.affectedRows === 0) {
    throw createHttpError(409, "Payment status changed before completion.", "PAYMENT_STATUS_CHANGED");
  }

  let activation = null;
  if (payment.membership_id) {
    activation = await membershipRepository.maybeAutoActivate(payment.membership_id, adminId);
  }

  if (payment.user_id) {
    const amountLabel = `${payment.currency || "SAR"} ${Number(payment.amount || 0).toFixed(2)}`;
    await query(
      `INSERT INTO notifications (user_id, type, title_ar, title_en, body_ar, body_en)
       VALUES (?, 'payment_succeeded', ?, ?, ?, ?)`,
      [
        payment.user_id,
        "تم استلام دفعتك",
        "Payment received",
        `تم استلام دفعتك بمبلغ ${amountLabel} بنجاح.`,
        `We received your payment of ${amountLabel} successfully.`
      ]
    ).catch(() => {});
  }

  return { id: payment.id, status: "completed", activation };
}

// ---- Moyasar hosted-checkout attempts --------------------------------------

const PAYMENT_COLUMNS = `id, branch_id, user_id, membership_id, plan_id, purpose, provider, payment_method,
  provider_reference, transaction_id, checkout_url, amount, currency, status, failure_reason,
  expires_at, invoice_id, created_at, completed_at`;

async function getPayment(id) {
  ensureDatabase();
  const rows = await query(`SELECT ${PAYMENT_COLUMNS} FROM payments WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

async function findByProviderReference(provider, reference) {
  ensureDatabase();
  const rows = await query(
    `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE provider = ? AND provider_reference = ? ORDER BY id DESC LIMIT 1`,
    [provider, reference]
  );
  return rows[0] || null;
}

// A still-open checkout for the same member + plan (double click, back
// button) -- reused instead of minting a second Moyasar invoice.
async function findOpenCheckout(userId, planId) {
  ensureDatabase();
  const rows = await query(
    `SELECT ${PAYMENT_COLUMNS} FROM payments
     WHERE user_id = ? AND plan_id = ? AND provider = 'moyasar' AND status = 'pending'
       AND checkout_url IS NOT NULL AND expires_at > UTC_TIMESTAMP() + INTERVAL 5 MINUTE
     ORDER BY id DESC LIMIT 1`,
    [userId, planId]
  );
  return rows[0] || null;
}

// Creates the pending payment row (and, for a first purchase, the pending
// membership it pays for) in one transaction. branch_id is always the
// member's own branch, passed in by the service from the DB user row.
async function createCheckoutAttempt({ userId, branchId, planId, amount, purpose, membershipId = null }) {
  ensureDatabase();
  return transaction(async (connection) => {
    let targetMembershipId = membershipId;
    if (purpose === "new") {
      const [membershipResult] = await connection.execute(
        "INSERT INTO memberships (user_id, plan_id, branch_id, status) VALUES (?, ?, ?, 'pending')",
        [userId, planId, branchId]
      );
      targetMembershipId = membershipResult.insertId;
    }
    const [paymentResult] = await connection.execute(
      `INSERT INTO payments (branch_id, user_id, membership_id, plan_id, purpose, provider, payment_method, amount, currency, status)
       VALUES (?, ?, ?, ?, ?, 'moyasar', 'moyasar', ?, 'SAR', 'pending')`,
      [branchId, userId, targetMembershipId, planId, purpose, amount]
    );
    return { paymentId: paymentResult.insertId, membershipId: targetMembershipId };
  });
}

async function setCheckoutDetails(paymentId, { reference, checkoutUrl, expiresAt }) {
  ensureDatabase();
  await query(
    `UPDATE payments SET provider_reference = ?, checkout_url = ?, expires_at = ?, updated_at = UTC_TIMESTAMP()
     WHERE id = ? AND status = 'pending'`,
    [reference, checkoutUrl, expiresAt, paymentId]
  );
}

// Records a non-terminal failed card attempt on a still-payable invoice
// (Moyasar keeps the invoice open for a retry).
async function noteAttemptFailure(paymentId, reason) {
  ensureDatabase();
  await query(
    "UPDATE payments SET failure_reason = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'pending'",
    [String(reason || "").slice(0, 255), paymentId]
  );
}

// pending -> failed | cancelled, exactly once. A 'new' purchase's pending
// membership is cancelled with it so it never lingers as a phantom. Returns
// true only for the call that actually closed the attempt (so follow-ups
// like the failed-payment task fire once).
async function closeCheckoutAttempt(paymentId, status, reason, rawPayload = null) {
  ensureDatabase();
  return transaction(async (connection) => {
    const [rows] = await connection.execute(
      "SELECT id, membership_id, purpose, status FROM payments WHERE id = ? FOR UPDATE",
      [paymentId]
    );
    const payment = rows[0];
    if (!payment || payment.status !== "pending") {
      return false;
    }
    await connection.execute(
      `UPDATE payments SET status = ?, failure_reason = COALESCE(?, failure_reason), raw_payload = COALESCE(?, raw_payload),
         checkout_url = NULL, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [status, reason ? String(reason).slice(0, 255) : null, rawPayload ? JSON.stringify(rawPayload) : null, paymentId]
    );
    if (payment.purpose === "new" && payment.membership_id) {
      await connection.execute(
        "UPDATE memberships SET status = 'cancelled', cancelled_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'pending'",
        [payment.membership_id]
      );
    }
    return true;
  });
}

// Pending Moyasar attempts for the reconcile job: anything older than a
// couple of minutes (a webhook may have been missed).
async function listPendingMoyasar(limit = 50) {
  ensureDatabase();
  return query(
    `SELECT ${PAYMENT_COLUMNS} FROM payments
     WHERE provider = 'moyasar' AND status = 'pending' AND created_at < UTC_TIMESTAMP() - INTERVAL 2 MINUTE
     ORDER BY created_at ASC
     LIMIT ${Math.max(1, Math.min(Number(limit) || 50, 200))}`
  );
}

// Reception-recorded payment (cash / card terminal / bank transfer), pending
// until paymentService.settlePaidPayment completes it in the same request.
// provider_reference carries the per-submission idempotency key; a
// concurrent double-submit hits the unique-ish lookup below inside the
// transaction (FOR UPDATE on the member row serialises them).
async function createManualAttempt({ userId, branchId, planId, amount, purpose, membershipId = null, method, reference, externalReference = null, adminId = null }) {
  ensureDatabase();
  return transaction(async (connection) => {
    await connection.execute("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
    const [dupes] = await connection.execute(
      "SELECT id FROM payments WHERE provider = 'manual' AND provider_reference = ? LIMIT 1",
      [reference]
    );
    if (dupes[0]) {
      return { paymentId: dupes[0].id, duplicate: true };
    }
    let targetMembershipId = membershipId;
    if (purpose === "new") {
      const [membershipResult] = await connection.execute(
        "INSERT INTO memberships (user_id, plan_id, branch_id, status, created_by) VALUES (?, ?, ?, 'pending', ?)",
        [userId, planId, branchId, adminId]
      );
      targetMembershipId = membershipResult.insertId;
    }
    const [paymentResult] = await connection.execute(
      `INSERT INTO payments (branch_id, user_id, membership_id, plan_id, purpose, provider, payment_method,
         provider_reference, transaction_id, amount, currency, status, created_by, employee_id)
       VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, 'SAR', 'pending', ?, ?)`,
      [branchId, userId, targetMembershipId, planId, purpose, method, reference, externalReference, amount, adminId, adminId]
    );
    return { paymentId: paymentResult.insertId, duplicate: false };
  });
}

function paymentFilters({ branchId = "", status = "", provider = "", method = "", dateFrom = "", dateTo = "", search = "" } = {}) {
  const where = ["p.branch_id = ?"];
  const params = [branchId];
  if (status) {
    where.push("p.status = ?");
    params.push(status);
  }
  if (provider) {
    where.push("p.provider = ?");
    params.push(provider);
  }
  if (method) {
    where.push("p.payment_method = ?");
    params.push(method);
  }
  if (dateFrom) {
    where.push("p.created_at >= ?");
    params.push(`${dateFrom} 00:00:00`);
  }
  if (dateTo) {
    where.push("p.created_at <= ?");
    params.push(`${dateTo} 23:59:59`);
  }
  if (search) {
    where.push("(u.full_name LIKE ? OR u.member_code = ? OR u.phone LIKE ? OR i.invoice_number = ?)");
    params.push(`%${search}%`, search, `%${search}%`, search);
  }
  return { where: where.join(" AND "), params };
}

// Admin payments list. branchId is REQUIRED (server-derived effective
// branch); empty means no rows, same convention as tasks/attendance.
// `all: true` (exports) returns up to 10k rows without pagination.
async function listPayments(filters = {}, { page = 1, pageSize = 25, all = false } = {}) {
  ensureDatabase();
  if (!filters.branchId) {
    return { items: [], pagination: { page: 1, pageSize, total: 0 }, totals: { completed: 0, count: 0 } };
  }
  const { where, params } = paymentFilters(filters);
  const limit = all ? 10000 : Math.max(1, Math.min(Number(pageSize) || 25, 100));
  const currentPage = all ? 1 : Math.max(1, Number(page) || 1);
  const offset = (currentPage - 1) * limit;
  const from = `FROM payments p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN plans pl ON pl.id = p.plan_id
     LEFT JOIN invoices i ON i.id = p.invoice_id
     LEFT JOIN admin_users a ON a.id = COALESCE(p.completed_by, p.created_by)
     WHERE ${where}`;
  const rows = await query(
    `SELECT p.id, p.user_id, u.full_name AS member, u.member_code, p.plan_id, pl.name_en AS plan_en, pl.name_ar AS plan_ar,
       p.purpose, p.provider, p.payment_method, p.amount, p.currency, p.status, p.failure_reason, p.transaction_id,
       p.invoice_id, i.invoice_number, i.tax_total, p.created_at, p.completed_at, a.full_name AS recorded_by
     ${from}
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const totals = await query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN p.status = 'completed' THEN p.amount ELSE 0 END), 0) AS completed
     ${from}`,
    params
  );
  return {
    items: rows,
    pagination: { page: currentPage, pageSize: limit, total: Number(totals[0]?.total || 0) },
    totals: { completed: Number(totals[0]?.completed || 0), count: Number(totals[0]?.total || 0) }
  };
}

module.exports = {
  closeCheckoutAttempt,
  createManualAttempt,
  listPayments,
  completePayment,
  createCheckoutAttempt,
  createPayment,
  findByProviderReference,
  findOpenCheckout,
  getPayment,
  listPendingMoyasar,
  noteAttemptFailure,
  setCheckoutDetails,
  getPaymentOwnerBranch,
  hasProcessedEvent,
  recordEvent
};
