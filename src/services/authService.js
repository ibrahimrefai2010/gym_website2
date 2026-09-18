const crypto = require("crypto");
const userRepository = require("../repositories/userRepository");
const adminRepository = require("../repositories/adminRepository");
const tokenRepository = require("../repositories/tokenRepository");
const { createHttpError } = require("../utils/httpError");
const {
  assertSaudiPhone,
  assertStrongPassword,
  cleanEmail,
  cleanPhone,
  cleanString,
  normalizeSaudiPhone,
  requireFields
} = require("../utils/validator");
const {
  signAccessToken,
  signRefreshToken,
  signResetToken,
  verifyRefreshToken,
  verifyResetToken
} = require("../utils/jwt");
const { verifyPassword } = require("../utils/hash");
const { createLog } = require("../utils/logger");
const { env } = require("../config/env");
const emailService = require("./emailService");

function durationToMs(value, fallbackMs) {
  const match = String(value || "").trim().match(/^(\d+)([smhd])$/i);
  if (!match) {
    return fallbackMs;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };
  return amount * multipliers[unit];
}

const REFRESH_MAX_AGE_MS = durationToMs(env.jwtRefreshExpiry, 7 * 24 * 60 * 60 * 1000);

function refreshExpiry() {
  return tokenRepository.utcDateFromNow(REFRESH_MAX_AGE_MS);
}

function otpExpiry() {
  return tokenRepository.utcDateFromNow(env.otpExpiryMinutes * 60 * 1000);
}

function resetExpiry() {
  return tokenRepository.utcDateFromNow(10 * 60 * 1000);
}

function normalizeIdentifier(identifier) {
  const value = cleanString(identifier, 150);
  return value.includes("@") ? cleanEmail(value) : normalizeSaudiPhone(value);
}

function responseUser(user) {
  return userRepository.publicUser(user);
}

function responseAdmin(admin) {
  return adminRepository.publicAdmin(admin);
}

async function issueSession({ subject, ipAddress, userAgent }) {
  const accessToken = signAccessToken(subject);
  const refreshToken = signRefreshToken(subject);
  await tokenRepository.createRefreshToken({
    token: refreshToken,
    subject,
    expiresAt: refreshExpiry(),
    ipAddress,
    userAgent
  });

  return { accessToken, refreshToken };
}

async function register(payload, context = {}) {
  requireFields(payload, ["fullName", "email", "phone", "password"]);
  assertSaudiPhone(payload.phone);
  assertStrongPassword(payload.password);

  // Branch is resolved once per request by branchResolver (subdomain), never
  // taken from the registration payload itself.
  const branchId = context.branchId || 1;
  const user = await userRepository.createUser({
    branchId,
    fullName: cleanString(payload.fullName, 160),
    email: cleanEmail(payload.email),
    phone: cleanPhone(payload.phone),
    password: payload.password
  });

  if (!user) {
    throw createHttpError(409, "A user with this email or phone already exists.", "USER_EXISTS");
  }

  const tokens = await issueSession({
    subject: { id: user.id, type: "user", role: null, branchId: user.branch_id || branchId },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent
  });
  await createLog("user", user.id, "auth.register", "users", user.id, null, context.ipAddress);
  await createLog("user", user.id, "auth.login", "users", user.id, { source: "register" }, context.ipAddress);

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    user: responseUser(user)
  };
}

async function login({ identifier, password, ipAddress, userAgent, branchId = null }) {
  if (!identifier || !password) {
    throw createHttpError(400, "Email or phone and password are required.", "LOGIN_FIELDS_REQUIRED");
  }

  // branchId (from the subdomain the request arrived on) scopes the lookup so
  // a same-email account in the *other* branch never matches here.
  const user = await userRepository.findForLogin(identifier, branchId);
  if (!user || user.status !== "active") {
    throw createHttpError(401, "Invalid credentials.", "INVALID_CREDENTIALS");
  }

  const passwordMatches = await verifyPassword(password, user.password_hash);
  if (!passwordMatches) {
    throw createHttpError(401, "Invalid credentials.", "INVALID_CREDENTIALS");
  }

  const tokens = await issueSession({
    subject: { id: user.id, type: "user", role: null, branchId: user.branch_id ?? branchId },
    ipAddress,
    userAgent
  });

  await createLog("user", user.id, "auth.login", "users", user.id, null, ipAddress);

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    user: responseUser(user)
  };
}

async function adminLogin({ identifier, password, ipAddress, userAgent }) {
  if (!identifier || !password) {
    throw createHttpError(400, "Email and password are required.", "LOGIN_FIELDS_REQUIRED");
  }

  const admin = await adminRepository.findForLogin(identifier);
  if (!admin || admin.status !== "active") {
    throw createHttpError(401, "Invalid credentials.", "INVALID_CREDENTIALS");
  }

  const passwordMatches = await verifyPassword(password, admin.password_hash);
  if (!passwordMatches) {
    throw createHttpError(401, "Invalid credentials.", "INVALID_CREDENTIALS");
  }

  const tokens = await issueSession({
    subject: { id: admin.id, type: "admin", role: admin.role, branchId: admin.branch_id ?? null },
    ipAddress,
    userAgent
  });

  await adminRepository.recordLogin(admin.id, ipAddress);
  await createLog("admin", admin.id, "auth.login", "admin_users", admin.id, null, ipAddress);

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    user: { ...responseAdmin(admin), mustChangePassword: Boolean(admin.must_change_password) }
  };
}

async function refresh(refreshToken, context = {}) {
  if (!refreshToken) {
    throw createHttpError(401, "Refresh token is required.", "REFRESH_REQUIRED");
  }

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (_error) {
    throw createHttpError(401, "Refresh token is invalid or expired.", "REFRESH_INVALID");
  }

  const subject = {
    id: Number(payload.sub),
    type: payload.type,
    role: payload.role || null
  };

  const principal =
    subject.type === "admin"
      ? await adminRepository.findById(subject.id)
      : await userRepository.findById(subject.id);
  if (!principal || principal.status !== "active") {
    throw createHttpError(401, "Session is no longer valid.", "SESSION_INVALID");
  }

  if (subject.type === "admin") {
    subject.role = principal.role;
  }
  // Always re-derive from the DB principal (freshest truth), never trust the
  // old token's branchId claim.
  subject.branchId = principal.branch_id != null ? Number(principal.branch_id) : null;

  const accessToken = signAccessToken(subject);
  const nextRefreshToken = signRefreshToken(subject);
  await tokenRepository.rotateRefreshToken({
    oldToken: refreshToken,
    newToken: nextRefreshToken,
    subject,
    expiresAt: refreshExpiry(),
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    idleLimitMs: subject.type === "admin" ? env.adminIdleTimeoutMinutes * 60 * 1000 : 0
  });

  return {
    accessToken,
    refreshToken: nextRefreshToken,
    user:
      subject.type === "admin"
        ? { ...responseAdmin(principal), mustChangePassword: Boolean(principal.must_change_password) }
        : responseUser(principal)
  };
}

async function logout(refreshToken, context = {}) {
  if (!refreshToken) {
    return { loggedOut: true };
  }

  try {
    const payload = verifyRefreshToken(refreshToken);
    await tokenRepository.revokeRefreshTokenByHash(refreshToken);
    await createLog(
      payload.type,
      payload.sub,
      "auth.logout",
      payload.type === "admin" ? "admin_users" : "users",
      payload.sub,
      null,
      context.ipAddress
    );
  } catch (_error) {
    return { loggedOut: true };
  }

  return { loggedOut: true };
}

async function forgotPassword(identifier, context = {}) {
  if (!identifier) {
    return { accepted: true };
  }

  const branchId = context.branchId || 1;
  const normalized = normalizeIdentifier(identifier);
  const user = await userRepository.findByEmailOrPhone(normalized, branchId).catch(() => null);
  if (user && user.status === "active") {
    const otp = String(crypto.randomInt(100000, 1000000));
    await tokenRepository.storeOtp({
      identifier: normalized,
      branchId,
      otp,
      purpose: "reset_password",
      expiresAt: otpExpiry(),
      ipAddress: context.ipAddress
    });
    await emailService.sendPasswordResetOtp(user.email, otp, branchId);
  }

  return {
    accepted: true,
    message: "If the account exists, a verification code will be sent."
  };
}

async function verifyOtp({ identifier, otp, branchId = null }) {
  if (!identifier || !otp) {
    throw createHttpError(400, "Identifier and OTP are required.", "OTP_FIELDS_REQUIRED");
  }

  const resolvedBranchId = branchId || 1;
  const normalized = normalizeIdentifier(identifier);
  const user = await userRepository.findByEmailOrPhone(normalized, resolvedBranchId);
  if (!user || user.status !== "active") {
    throw createHttpError(401, "Invalid or expired OTP.", "OTP_INVALID");
  }

  const otpId = await tokenRepository.verifyOtp({
    identifier: normalized,
    branchId: resolvedBranchId,
    otp: cleanString(otp, 6),
    purpose: "reset_password"
  });

  if (!otpId) {
    throw createHttpError(401, "Invalid or expired OTP.", "OTP_INVALID");
  }

  const jti = tokenRepository.randomJti();
  const resetToken = signResetToken(user, jti);
  await tokenRepository.createPasswordResetToken({
    userId: user.id,
    resetToken,
    expiresAt: resetExpiry()
  });

  return { reset_token: resetToken };
}

async function resetPassword({ resetToken, password }, context = {}) {
  if (!resetToken || !password) {
    throw createHttpError(400, "Reset token and new password are required.", "RESET_FIELDS_REQUIRED");
  }
  assertStrongPassword(password);

  let payload;
  try {
    payload = verifyResetToken(resetToken);
  } catch (_error) {
    throw createHttpError(401, "Reset token is invalid or expired.", "RESET_TOKEN_INVALID");
  }

  const consumed = await tokenRepository.consumePasswordResetToken({
    userId: payload.sub,
    resetToken
  });
  if (!consumed) {
    throw createHttpError(401, "Reset token is invalid or expired.", "RESET_TOKEN_INVALID");
  }

  await userRepository.updatePassword(payload.sub, password);
  await tokenRepository.revokeAllRefreshTokens({ id: payload.sub, type: "user" });
  await createLog("user", payload.sub, "auth.password_reset", "users", payload.sub, null, context.ipAddress);

  return { reset: true };
}

async function adminChangePassword({ adminId, currentPassword, newPassword }, context = {}) {
  if (!currentPassword || !newPassword) {
    throw createHttpError(400, "Current and new password are required.", "PASSWORD_FIELDS_REQUIRED");
  }
  assertStrongPassword(newPassword);

  const admin = await adminRepository.findForLoginById(adminId);
  if (!admin) {
    throw createHttpError(401, "Session is no longer valid.", "SESSION_INVALID");
  }

  const matches = await verifyPassword(currentPassword, admin.password_hash);
  if (!matches) {
    throw createHttpError(401, "Current password is incorrect.", "CURRENT_PASSWORD_INVALID");
  }
  if (await verifyPassword(newPassword, admin.password_hash)) {
    throw createHttpError(422, "New password must be different from the current one.", "PASSWORD_UNCHANGED");
  }

  await adminRepository.updatePassword(adminId, newPassword);
  await tokenRepository.revokeAllRefreshTokens({ id: adminId, type: "admin" });
  await createLog("admin", adminId, "auth.password_change", "admin_users", adminId, null, context.ipAddress);

  return { changed: true };
}

module.exports = {
  REFRESH_MAX_AGE_MS,
  adminChangePassword,
  adminLogin,
  forgotPassword,
  login,
  logout,
  refresh,
  register,
  resetPassword,
  verifyOtp
};
