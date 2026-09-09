const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { hasDatabaseConfig, query, transaction } = require("../config/database");
const { createHttpError } = require("../utils/httpError");
const { tokenHash } = require("../utils/hash");

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

function utcDateFromNow(ms) {
  return new Date(Date.now() + ms).toISOString().slice(0, 19).replace("T", " ");
}

async function createRefreshToken({ token, subject, expiresAt, ipAddress, userAgent }, connection = null) {
  ensureDatabase();
  const executor = connection || { execute: async (sql, params) => [await query(sql, params)] };
  const sql =
    subject.type === "admin"
      ? `INSERT INTO refresh_tokens (admin_user_id, token_hash, expires_at, ip_address, user_agent, last_used_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())`
      : `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent, last_used_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())`;
  const [result] = await executor.execute(sql, [
    subject.id,
    tokenHash(token),
    expiresAt,
    ipAddress || null,
    userAgent || null
  ]);
  return result.insertId;
}

async function findRefreshToken(token) {
  ensureDatabase();
  const rows = await query(
    `SELECT id, user_id, admin_user_id, token_hash, expires_at, revoked_at
     FROM refresh_tokens
     WHERE token_hash = ?
     LIMIT 1`,
    [tokenHash(token)]
  );
  return rows[0] || null;
}

async function findRevokedRefreshBySubject(subject) {
  ensureDatabase();
  const rows = await query(
    subject.type === "admin"
      ? `SELECT id FROM refresh_tokens
         WHERE admin_user_id = ? AND token_hash = ? AND revoked_at IS NOT NULL
         LIMIT 1`
      : `SELECT id FROM refresh_tokens
         WHERE user_id = ? AND token_hash = ? AND revoked_at IS NOT NULL
         LIMIT 1`,
    [subject.id, tokenHash(subject.token)]
  );
  return rows[0] || null;
}

async function revokeRefreshTokenByHash(token, connection = null) {
  ensureDatabase();
  const executor = connection || { execute: async (sql, params) => [await query(sql, params)] };
  await executor.execute(
    "UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE token_hash = ? AND revoked_at IS NULL",
    [tokenHash(token)]
  );
}

async function revokeAllRefreshTokens(subject, connection = null) {
  ensureDatabase();
  const executor = connection || { execute: async (sql, params) => [await query(sql, params)] };
  await executor.execute(
    subject.type === "admin"
      ? "UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE admin_user_id = ? AND revoked_at IS NULL"
      : "UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL",
    [subject.id]
  );
}

async function rotateRefreshToken({ oldToken, newToken, subject, expiresAt, ipAddress, userAgent, idleLimitMs = 0 }) {
  ensureDatabase();
  const outcome = await transaction(async (connection) => {
    const [rows] = await connection.execute(
      `SELECT id, revoked_at, expires_at,
        TIMESTAMPDIFF(SECOND, last_used_at, UTC_TIMESTAMP()) AS idle_seconds
       FROM refresh_tokens
       WHERE token_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [tokenHash(oldToken)]
    );

    const current = rows[0] || null;
    if (!current) {
      return { invalid: true };
    }

    if (current.revoked_at) {
      await revokeAllRefreshTokens(subject, connection);
      return { reused: true };
    }

    if (new Date(current.expires_at) < new Date()) {
      await revokeRefreshTokenByHash(oldToken, connection);
      return { expired: true };
    }

    // Idle-session timeout (admins): if this session has not been used within the
    // allowed window, retire it and force a fresh login. Compared entirely in
    // SQL (UTC vs UTC) so it is independent of the driver's date handling.
    if (idleLimitMs > 0 && current.idle_seconds != null && current.idle_seconds * 1000 > idleLimitMs) {
      await revokeRefreshTokenByHash(oldToken, connection);
      return { idle: true };
    }

    await revokeRefreshTokenByHash(oldToken, connection);
    await createRefreshToken({ token: newToken, subject, expiresAt, ipAddress, userAgent }, connection);
    return { rotated: true };
  });

  if (outcome.reused) {
    throw createHttpError(401, "Refresh token reuse detected. All refresh tokens were revoked.", "REFRESH_REUSED");
  }
  if (outcome.idle) {
    throw createHttpError(401, "Session ended after inactivity. Please sign in again.", "SESSION_IDLE_TIMEOUT");
  }
  if (outcome.expired || outcome.invalid) {
    throw createHttpError(401, "Refresh token is invalid or expired.", "REFRESH_INVALID");
  }
}

async function storeOtp({ identifier, otp, purpose, expiresAt, ipAddress }) {
  ensureDatabase();
  const hash = await bcrypt.hash(otp, 12);
  const result = await query(
    `INSERT INTO otp_tokens (identifier, token_hash, purpose, expires_at, ip_address)
     VALUES (?, ?, ?, ?, ?)`,
    [identifier, hash, purpose, expiresAt, ipAddress || null]
  );
  return result.insertId;
}

async function verifyOtp({ identifier, otp, purpose }) {
  ensureDatabase();
  const rows = await query(
    `SELECT id, token_hash
     FROM otp_tokens
     WHERE identifier = ? AND purpose = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()
     ORDER BY created_at DESC
     LIMIT 5`,
    [identifier, purpose]
  );

  for (const row of rows) {
    if (await bcrypt.compare(otp, row.token_hash)) {
      await query("UPDATE otp_tokens SET used_at = UTC_TIMESTAMP() WHERE id = ?", [row.id]);
      return row.id;
    }
  }

  return null;
}

async function createPasswordResetToken({ userId, resetToken, expiresAt }) {
  ensureDatabase();
  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES (?, ?, ?)`,
    [userId, tokenHash(resetToken), expiresAt]
  );
}

async function consumePasswordResetToken({ userId, resetToken }) {
  ensureDatabase();
  return transaction(async (connection) => {
    const [rows] = await connection.execute(
      `SELECT id, used_at, expires_at
       FROM password_reset_tokens
       WHERE user_id = ? AND token_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [userId, tokenHash(resetToken)]
    );
    const token = rows[0] || null;
    if (!token || token.used_at || new Date(token.expires_at) < new Date()) {
      return false;
    }
    await connection.execute("UPDATE password_reset_tokens SET used_at = UTC_TIMESTAMP() WHERE id = ?", [token.id]);
    return true;
  });
}

async function cleanExpiredOtps() {
  ensureDatabase();
  return query("DELETE FROM otp_tokens WHERE expires_at < UTC_TIMESTAMP() AND used_at IS NULL");
}

function randomJti() {
  return crypto.randomBytes(16).toString("hex");
}

module.exports = {
  cleanExpiredOtps,
  createPasswordResetToken,
  createRefreshToken,
  consumePasswordResetToken,
  findRefreshToken,
  findRevokedRefreshBySubject,
  randomJti,
  revokeAllRefreshTokens,
  revokeRefreshTokenByHash,
  rotateRefreshToken,
  storeOtp,
  utcDateFromNow,
  verifyOtp
};
