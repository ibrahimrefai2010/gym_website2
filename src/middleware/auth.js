const { verifyAccessToken } = require("../utils/jwt");
const { createHttpError } = require("../utils/httpError");
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
      role: payload.type === "admin" ? principal.role : "member"
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

module.exports = {
  authenticate,
  requireAdmin,
  requirePermission,
  requireRole
};
