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

module.exports = {
  closeCheckoutAttempt,
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
