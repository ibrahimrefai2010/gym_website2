const crypto = require("crypto");
const { hasDatabaseConfig, query } = require("../config/database");
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

module.exports = {
  completePayment,
  createPayment,
  hasProcessedEvent,
  recordEvent
};
