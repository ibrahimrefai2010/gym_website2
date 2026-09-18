const { verifyAccessToken, verifyRefreshToken } = require("../utils/jwt");
const { createHttpError } = require("../utils/httpError");
const { refreshTokenFromRequest } = require("../utils/cookies");
const rbacRepository = require("../repositories/rbacRepository");
const adminRepository = require("../repositories/adminRepository");
const userRepository = require("../repositories/userRepository");

async function authenticate(req, _res, next) {
  const header = req.get("authorization") || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(createHttpError(401, "Authentication is required.", "AUTH_REQUIRED"));
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (_error) {
    return next(createHttpError(401, "Session expired or invalid.", "AUTH_INVALID"));
  }

  try {
    const principal =
      payload.type === "admin"
        ? await adminRepository.findById(payload.sub)
        : await userRepository.findById(payload.sub);
    if (!principal || principal.status !== "active") {
      return next(createHttpError(401, "Session is no longer valid.", "SESSION_INVALID"));
    }

    req.user = {
      id: Number(payload.sub),
      type: payload.type,
      role: payload.type === "admin" ? principal.role : "member",
      mustChangePassword: payload.type === "admin" ? Boolean(principal.must_change_password) : false,
      // Always the DB-sourced value (freshest truth), never the JWT claim --
      // a client cannot spoof its own branch by holding an older token.
      branchId: principal.branch_id != null ? Number(principal.branch_id) : null
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

// For GET requests that a plain <img>/<a> makes (no Authorization header can be
// attached). Uses the Bearer token when present, otherwise the httpOnly refresh
// cookie. Read-only surfaces only.
async function authenticateMedia(req, _res, next) {
  const header = req.get("authorization") || "";
  if (header.startsWith("Bearer ")) {
    return authenticate(req, _res, next);
  }

  const refreshToken = refreshTokenFromRequest(req);
  if (!refreshToken) {
    return next(createHttpError(401, "Authentication is required.", "AUTH_REQUIRED"));
  }

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (_error) {
    return next(createHttpError(401, "Session expired or invalid.", "AUTH_INVALID"));
  }

  try {
    const principal =
      payload.type === "admin"
        ? await adminRepository.findById(payload.sub)
        : await userRepository.findById(payload.sub);
    if (!principal || principal.status !== "active") {
      return next(createHttpError(401, "Session is no longer valid.", "SESSION_INVALID"));
    }
    req.user = {
      id: Number(payload.sub),
      type: payload.type,
      role: payload.type === "admin" ? principal.role : "member",
      mustChangePassword: payload.type === "admin" ? Boolean(principal.must_change_password) : false,
      branchId: principal.branch_id != null ? Number(principal.branch_id) : null
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireRole(...roles) {
  return function roleGuard(req, _res, next) {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(createHttpError(403, "You do not have permission to access this resource.", "FORBIDDEN"));
    }

    return next();
  };
}

function requireAdmin(req, _res, next) {
  if (!req.user || req.user.type !== "admin") {
    return next(createHttpError(403, "Administrator access is required.", "ADMIN_REQUIRED"));
  }

  // First-login gate: an admin flagged for a forced password change may only
  // reach the change-password endpoint until it is done.
  if (req.user.mustChangePassword) {
    const path = String(req.originalUrl || "").split("?")[0];
    if (!path.endsWith("/admin/auth/change-password")) {
      return next(
        createHttpError(403, "You must change your password before continuing.", "PASSWORD_CHANGE_REQUIRED")
      );
    }
  }

  return next();
}

function requirePermission(permission) {
  return async function permissionGuard(req, _res, next) {
    try {
      if (req.user?.type !== "admin") {
        return next(createHttpError(403, "Administrator access is required.", "ADMIN_REQUIRED"));
      }

      const isAllowed = await rbacRepository.hasPermission(req.user.id, req.user.role, permission);
      if (isAllowed) {
        return next();
      }

      return next(createHttpError(403, "Your admin role cannot perform this action.", "PERMISSION_DENIED"));
    } catch (error) {
      return next(error);
    }
  };
}

// Leads/CRM (Part 2): the messages list is the one endpoint two separate
// permission grants must both be able to reach -- messages:write (inbox
// triage: existing behavior, unchanged) and leads:read (CRM viewing --
// e.g. the "marketing" role has leads:read but not messages:write, see
// src/security/permissions.js). Every other route in this app gates on a
// single permission, so this stays a small, local OR-check rather than a
// new general-purpose abstraction.
function requireAnyPermission(...permissions) {
  return async function anyPermissionGuard(req, _res, next) {
    try {
      if (req.user?.type !== "admin") {
        return next(createHttpError(403, "Administrator access is required.", "ADMIN_REQUIRED"));
      }

      for (const permission of permissions) {
        // eslint-disable-next-line no-await-in-loop
        if (await rbacRepository.hasPermission(req.user.id, req.user.role, permission)) {
          return next();
        }
      }

      return next(createHttpError(403, "Your admin role cannot perform this action.", "PERMISSION_DENIED"));
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  authenticate,
  authenticateMedia,
  requireAdmin,
  requireAnyPermission,
  requirePermission,
  requireRole
};
