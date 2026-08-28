const { hasDatabaseConfig, query } = require("../config/database");
const { createHttpError } = require("../utils/httpError");

const demoMessages = [
  {
    id: 1,
    name: "Lina Ahmed",
    email: "lina@example.com",
    phone: "+966500000011",
    subject: "Private tour",
    message: "I would like to book a tour this week.",
    status: "unread",
    createdAt: "2026-06-23"
  }
];

async function createMessage(payload) {
  if (!hasDatabaseConfig()) {
    const message = { id: demoMessages.length + 1, status: "unread", createdAt: new Date().toISOString(), ...payload };
    demoMessages.unshift(message);
    return message;
  }

  const result = await query(
    `INSERT INTO messages (name, email, phone, subject, message, status, ip_address)
     VALUES (?, ?, ?, ?, ?, 'unread', ?)`,
    [payload.name, payload.email, payload.phone, payload.subject, payload.message, payload.ipAddress || null]
  );

  return { id: result.insertId, ...payload, status: "unread" };
}

async function listMessages({ status } = {}) {
  if (!hasDatabaseConfig()) {
    return status ? demoMessages.filter((message) => message.status === status) : demoMessages;
  }

  const params = [];
  const where = status ? "WHERE status = ?" : "";
  if (status) {
    params.push(status);
  }

  const rows = await query(
    `SELECT id, name, email, phone, subject, message, status, created_at
     FROM messages
     ${where}
     ORDER BY created_at DESC
     LIMIT 100`,
    params
  );

  return rows.map((message) => ({ ...message, createdAt: message.created_at }));
}

async function updateMessage(id, payload) {
  if (!hasDatabaseConfig()) {
    const message = demoMessages.find((item) => String(item.id) === String(id));
    if (!message) {
      throw createHttpError(404, "Message not found.", "MESSAGE_NOT_FOUND");
    }
    Object.assign(message, payload);
    return message;
  }

  await query("UPDATE messages SET status = COALESCE(?, status), updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
    payload.status || null,
    id
  ]);
  const rows = await query("SELECT id, status FROM messages WHERE id = ? LIMIT 1", [id]);
  if (!rows[0]) {
    throw createHttpError(404, "Message not found.", "MESSAGE_NOT_FOUND");
  }
  return { id, status: rows[0].status, updated: true };
}

async function deleteMessage(id) {
  if (!hasDatabaseConfig()) {
    const index = demoMessages.findIndex((item) => String(item.id) === String(id));
    if (index >= 0) {
      demoMessages.splice(index, 1);
    }
    return { id, deleted: true };
  }

  await query("DELETE FROM messages WHERE id = ?", [id]);
  return { id, deleted: true };
}

module.exports = {
  createMessage,
  deleteMessage,
  listMessages,
  updateMessage
};
