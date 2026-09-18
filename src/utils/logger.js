const pino = require("pino");
const db = require("../config/database");

const appLogger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  redact: {
    paths: ["req.headers.authorization", "password", "token", "refreshToken"],
    remove: true
  }
});

// branchId is optional and, today, only threaded through by the admin
// plan/offer/settings write paths this feature touches directly (see
// adminController.js, planController.js, offerController.js) -- most other
// createLog() call sites across the app still pass none, so most existing
// and future log rows keep branch_id = NULL until a dedicated later phase
// threads it through every call site. listResource's logs query treats NULL
// as "not branch-tagged, visible everywhere" for exactly this reason (see
// adminRepository.js).
async function createLog(actorType, actorId, action, targetTable = null, targetId = null, meta = null, ipAddress = null, branchId = null) {
  if (!db.hasDatabaseConfig() || !actorType || !actorId || !action) {
    return;
  }

  const metaJson = meta === undefined || meta === null ? null : JSON.stringify(meta);
  await db.query(
    `INSERT INTO logs (actor_type, actor_id, action, target_table, target_id, meta, ip_address, branch_id)
     VALUES (?, ?, ?, ?, ?, CAST(? AS CHAR CHARACTER SET utf8mb4), ?, ?)`,
    [
      actorType,
      actorId,
      action,
      targetTable,
      targetId,
      metaJson,
      ipAddress,
      branchId != null ? Number(branchId) : null
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
