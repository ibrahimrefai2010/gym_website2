const { hasDatabaseConfig, query } = require("../config/database");
const { createHttpError } = require("../utils/httpError");
const { tokenHash } = require("../utils/hash");

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

function describeClient(userAgent) {
  const ua = String(userAgent || "");
  if (!ua) {
    return { browser: "Unknown", platform: "Unknown" };
  }
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\//.test(ua) ? "Opera" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Safari\//.test(ua) ? "Safari" :
    "Browser";
  const platform =
    /Windows/.test(ua) ? "Windows" :
    /Android/.test(ua) ? "Android" :
    /iPhone|iPad|iOS/.test(ua) ? "iOS" :
    /Mac OS X|Macintosh/.test(ua) ? "macOS" :
    /Linux/.test(ua) ? "Linux" :
    "Unknown";
  return { browser, platform };
}

async function listForUser(userId, currentRefreshToken) {
  ensureDatabase();
  const currentHash = currentRefreshToken ? tokenHash(currentRefreshToken) : null;
  const rows = await query(
    `SELECT id, token_hash, ip_address, user_agent, created_at, expires_at
     FROM refresh_tokens
     WHERE user_id = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()
     ORDER BY created_at DESC
     LIMIT 25`,
    [userId]
  );
  return rows.map((row) => {
    const client = describeClient(row.user_agent);
    return {
      id: row.id,
      browser: client.browser,
      platform: client.platform,
      ipAddress: row.ip_address || null,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      current: currentHash != null && row.token_hash === currentHash
    };
  });
}

async function revokeForUser(userId, sessionId, currentRefreshToken) {
  ensureDatabase();
  const currentHash = currentRefreshToken ? tokenHash(currentRefreshToken) : null;
  const rows = await query(
    "SELECT id, token_hash FROM refresh_tokens WHERE id = ? AND user_id = ? AND revoked_at IS NULL LIMIT 1",
    [sessionId, userId]
  );
  if (!rows[0]) {
    throw createHttpError(404, "Session not found.", "SESSION_NOT_FOUND");
  }
  await query("UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ?", [
    sessionId,
    userId
  ]);
  return { revoked: true, wasCurrent: currentHash != null && rows[0].token_hash === currentHash };
}

async function revokeOthersForUser(userId, currentRefreshToken) {
  ensureDatabase();
  const currentHash = currentRefreshToken ? tokenHash(currentRefreshToken) : null;
  const result = await query(
    `UPDATE refresh_tokens
     SET revoked_at = UTC_TIMESTAMP()
     WHERE user_id = ? AND revoked_at IS NULL AND (? IS NULL OR token_hash <> ?)`,
    [userId, currentHash, currentHash]
  );
  return { revoked: result.affectedRows };
}

module.exports = {
  listForUser,
  revokeForUser,
  revokeOthersForUser
};
