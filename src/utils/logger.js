const pino = require("pino");
const db = require("../config/database");

const appLogger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  redact: {
    paths: ["req.headers.authorization", "password", "token", "refreshToken"],
    remove: true
  }
});

async function createLog(actorType, actorId, action, targetTable = null, targetId = null, meta = null, ipAddress = null) {
  if (!db.hasDatabaseConfig() || !actorType || !actorId || !action) {
    return;
  }

  const metaJson = meta === undefined || meta === null ? null : JSON.stringify(meta);
  await db.query(
    `INSERT INTO logs (actor_type, actor_id, action, target_table, target_id, meta, ip_address)
     VALUES (?, ?, ?, ?, ?, CAST(? AS CHAR CHARACTER SET utf8mb4), ?)`,
    [
      actorType,
      actorId,
      action,
      targetTable,
      targetId,
      metaJson,
      ipAddress
    ]
  );
}

async function auditLog({ actorType = "user", actorId = null, action, entityType = null, entityId = null, description = "", ipAddress = null, context = null }) {
  return createLog(actorType, actorId, action, entityType, entityId, { description, ...(context || {}) }, ipAddress);
}

module.exports = {
  appLogger,
  auditLog,
  createLog
};
