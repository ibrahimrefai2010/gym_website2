const { hasDatabaseConfig, query } = require("../config/database");
const { createHttpError } = require("../utils/httpError");
const { positiveInteger } = require("../utils/validator");

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

const TRANSACTIONAL_TYPES = new Set([
  "membership_expired",
  "renewal_reminder",
  "membership_expiring",
  "membership_renewed",
  "membership_activated",
  "payment_succeeded",
  "payment_failed",
  "password_changed",
  "security"
]);

function mapNotification(row) {
  return {
    id: row.id,
    type: row.type,
    category: TRANSACTIONAL_TYPES.has(row.type) ? "transactional" : "announcement",
    title: { ar: row.title_ar || "", en: row.title_en || "" },
    body: { ar: row.body_ar || "", en: row.body_en || "" },
    isRead: Boolean(row.is_read),
    readAt: row.read_at,
    createdAt: row.created_at
  };
}

async function listForUser(userId, { page = 1, pageSize = 20, unreadOnly = false } = {}) {
  ensureDatabase();
  const limit = positiveInteger(pageSize, 20, 50);
  const currentPage = positiveInteger(page, 1, 100000);
  const offset = (currentPage - 1) * limit;
  const where = ["user_id = ?"];
  const params = [userId];
  if (unreadOnly) {
    where.push("is_read = 0");
  }

  const rows = await query(
    `SELECT id, type, title_ar, title_en, body_ar, body_en, is_read, read_at, created_at
     FROM notifications
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC, id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const totalRows = await query(
    `SELECT COUNT(*) AS total FROM notifications WHERE ${where.join(" AND ")}`,
    params
  );
  const unreadRows = await query(
    "SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND is_read = 0",
    [userId]
  );

  return {
    items: rows.map(mapNotification),
    pagination: {
      page: currentPage,
      pageSize: limit,
      total: Number(totalRows[0]?.total || 0)
    },
    unreadCount: Number(unreadRows[0]?.total || 0)
  };
}

async function unreadCount(userId) {
  ensureDatabase();
  const rows = await query(
    "SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND is_read = 0",
    [userId]
  );
  return Number(rows[0]?.total || 0);
}

async function recentForUser(userId, limit = 4) {
  ensureDatabase();
  const safeLimit = positiveInteger(limit, 4, 10);
  const rows = await query(
    `SELECT id, type, title_ar, title_en, body_ar, body_en, is_read, read_at, created_at
     FROM notifications
     WHERE user_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ${safeLimit}`,
    [userId]
  );
  return rows.map(mapNotification);
}

async function markRead(userId, notificationId) {
  ensureDatabase();
  const result = await query(
    `UPDATE notifications
     SET is_read = 1, read_at = COALESCE(read_at, UTC_TIMESTAMP())
     WHERE id = ? AND user_id = ? AND is_read = 0`,
    [notificationId, userId]
  );
  return { updated: result.affectedRows > 0 };
}

async function markAllRead(userId) {
  ensureDatabase();
  const result = await query(
    `UPDATE notifications
     SET is_read = 1, read_at = COALESCE(read_at, UTC_TIMESTAMP())
     WHERE user_id = ? AND is_read = 0`,
    [userId]
  );
  return { updated: result.affectedRows };
}

async function createForUser(userId, notification) {
  ensureDatabase();
  const result = await query(
    `INSERT INTO notifications (user_id, type, title_ar, title_en, body_ar, body_en)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userId,
      String(notification.type || "notice").slice(0, 50),
      notification.titleAr || null,
      notification.titleEn || null,
      notification.bodyAr || null,
      notification.bodyEn || null
    ]
  );
  return { id: result.insertId };
}

const PREFERENCE_KEYS = [
  "email_transactional",
  "sms_transactional",
  "email_marketing",
  "sms_marketing",
  "whatsapp_marketing"
];

function mapPreferences(row) {
  const source = row || {};
  return {
    emailTransactional: source.email_transactional === undefined ? true : Boolean(source.email_transactional),
    smsTransactional: Boolean(source.sms_transactional),
    emailMarketing: Boolean(source.email_marketing),
    smsMarketing: Boolean(source.sms_marketing),
    whatsappMarketing: Boolean(source.whatsapp_marketing),
    inappTransactional: true
  };
}

async function getPreferences(userId) {
  ensureDatabase();
  const rows = await query(
    `SELECT email_transactional, sms_transactional, email_marketing, sms_marketing, whatsapp_marketing
     FROM notification_preferences
     WHERE user_id = ?
     LIMIT 1`,
    [userId]
  );
  return mapPreferences(rows[0]);
}

async function updatePreferences(userId, payload) {
  ensureDatabase();
  const current = await getPreferences(userId);
  const next = {
    email_transactional: pick(payload.emailTransactional, current.emailTransactional),
    sms_transactional: pick(payload.smsTransactional, current.smsTransactional),
    email_marketing: pick(payload.emailMarketing, current.emailMarketing),
    sms_marketing: pick(payload.smsMarketing, current.smsMarketing),
    whatsapp_marketing: pick(payload.whatsappMarketing, current.whatsappMarketing)
  };

  await query(
    `INSERT INTO notification_preferences
       (user_id, ${PREFERENCE_KEYS.join(", ")})
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       ${PREFERENCE_KEYS.map((key) => `${key} = VALUES(${key})`).join(", ")}`,
    [userId, ...PREFERENCE_KEYS.map((key) => (next[key] ? 1 : 0))]
  );

  return getPreferences(userId);
}

function pick(value, fallback) {
  if (value === undefined || value === null) {
    return Boolean(fallback);
  }
  if (typeof value === "string") {
    return value === "true" || value === "1" || value === "on";
  }
  return Boolean(value);
}

module.exports = {
  createForUser,
  getPreferences,
  listForUser,
  markAllRead,
  markRead,
  recentForUser,
  unreadCount,
  updatePreferences
};
