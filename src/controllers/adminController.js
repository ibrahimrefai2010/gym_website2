const adminRepository = require("../repositories/adminRepository");
const backupService = require("../services/backupService");
const imageUploadService = require("../services/imageUploadService");
const { createHttpError } = require("../utils/httpError");
const { env } = require("../config/env");
const { assertSaudiPhone, assertStrongPassword, cleanEmail, cleanPhone, cleanString, requireFields } = require("../utils/validator");
const { createLog } = require("../utils/logger");
const rbacRepository = require("../repositories/rbacRepository");

const writePermissions = {
  plans: "plans:write",
  notifications: "notifications:manage",
  offers: "offers:write",
  settings: "settings:write",
  siteImages: "settings:write",
  slides: "settings:write",
  roles: "roles:manage",
  permissions: "permissions:manage",
  rolePermissions: "permissions:manage",
  adminRoleAssignments: "roles:manage"
};

const readPermissions = {
  adminAccounts: "roles:manage",
  adminRoleAssignments: "roles:manage",
  notificationBroadcasts: "notifications:manage",
  logs: "audit_logs:read",
  memberships: "memberships:read",
  messages: "messages:write",
  notifications: "notifications:manage",
  offers: "offers:write",
  payments: "payments:read",
  permissions: "permissions:manage",
  plans: "plans:write",
  rolePermissions: "permissions:manage",
  roles: "roles:manage",
  settings: "settings:write",
  siteImages: "settings:write",
  slides: "settings:write",
  users: "users:read"
};

async function overview(req, res) {
  const data = await adminRepository.getOverview();
  const checks = await Promise.all(
    [
      ["users", "users:read"],
      ["memberships", "memberships:read"],
      ["payments", "payments:read"],
      ["logs", "audit_logs:read"],
      ["messages", "messages:write"],
      ["notifications", "notifications:manage"],
      ["adminAccounts", "roles:manage"]
    ].map(async ([section, permission]) => [
      section,
      await rbacRepository.hasPermission(req.user?.id, req.user?.role, permission)
    ])
  );
  for (const [section, allowed] of checks) {
    if (!allowed) {
      data[section] = [];
    }
  }
  res.json({ success: true, data });
}

async function list(req, res) {
  const permission = readPermissions[req.params.resource];
  if (permission && !(await rbacRepository.hasPermission(req.user?.id, req.user?.role, permission))) {
    throw createHttpError(403, "Your admin role cannot access this resource.", "PERMISSION_DENIED");
  }

  const data = await adminRepository.listResource(req.params.resource);
  res.json({ success: true, data });
}

async function save(req, res) {
  const resource = req.params.resource;
  let data;
  const permission = writePermissions[resource];
  if (permission && !(await rbacRepository.hasPermission(req.user?.id, req.user?.role, permission))) {
    throw createHttpError(403, "Your admin role cannot perform this action.", "PERMISSION_DENIED");
  }

  if (resource === "plans") {
    data = await adminRepository.savePlan({ ...req.body, branchId: req.body.branchId || req.user?.branchId });
    await createLog("admin", req.user?.id, req.body.id ? "plan.update" : "plan.create", "plans", data?.id || req.body.id || null, null, req.ip);
  } else if (resource === "offers") {
    data = await adminRepository.saveOffer({ ...req.body, branchId: req.body.branchId || req.user?.branchId });
    await createLog("admin", req.user?.id, req.body.id ? "offer.update" : "offer.create", "offers", data?.id || req.body.id || null, null, req.ip);
  } else if (resource === "settings") {
    data = await adminRepository.saveSetting(req.body, req.user?.id);
    await createLog("admin", req.user?.id, "settings.update", "settings", null, { key: data.key }, req.ip);
  } else if (resource === "siteImages") {
    data = await adminRepository.saveSiteImages(req.body, req.user?.id);
    await createLog("admin", req.user?.id, "settings.images.update", "settings", null, null, req.ip);
  } else if (resource === "slides") {
    data = await adminRepository.saveSlide(req.body);
    await createLog("admin", req.user?.id, req.body.id ? "slide.update" : "slide.create", "slider_images", data?.id || null, null, req.ip);
  } else if (resource === "roles") {
    data = await adminRepository.saveRole(req.body);
    await createLog("admin", req.user?.id, "role.upsert", "roles", data?.id || null, { key: data?.key }, req.ip);
  } else if (resource === "permissions") {
    data = await adminRepository.savePermission(req.body);
    await createLog("admin", req.user?.id, "permission.upsert", "permissions", data?.id || null, { key: data?.key }, req.ip);
  } else if (resource === "rolePermissions") {
    data = await adminRepository.setRolePermissions(req.body, req.user?.id);
    await createLog("admin", req.user?.id, "role.permissions.update", "roles", null, data, req.ip);
  } else if (resource === "adminRoleAssignments") {
    data = await adminRepository.setAdminRoles(req.body, req.user?.id);
    await createLog("admin", req.user?.id, "admin.roles.update", "admin_users", data.adminId, { roleKeys: data.roleKeys }, req.ip);
  } else if (resource === "notifications") {
    data = await adminRepository.broadcastNotification(req.body);
    await createLog(
      "admin",
      req.user?.id,
      "notification.broadcast",
      "notifications",
      null,
      { audience: data.audience, type: data.type, recipients: data.recipients },
      req.ip
    );
  } else {
    throw createHttpError(404, "This resource does not support writes yet.", "WRITE_NOT_SUPPORTED");
  }

  res.status(201).json({ success: true, data });
}

async function createAdmin(req, res) {
  if (!env.adminRegistrationSecret || req.get("x-admin-secret") !== env.adminRegistrationSecret) {
    throw createHttpError(403, "Admin registration secret is required.", "ADMIN_SECRET_REQUIRED");
  }

  requireFields(req.body, ["fullName", "email", "password", "role"]);
  assertStrongPassword(req.body.password);
  if (req.body.phone) {
    assertSaudiPhone(req.body.phone);
  }
  const role = cleanString(req.body.role, 40);
  if (!["super_admin", "admin", "manager", "staff"].includes(role)) {
    throw createHttpError(422, "Invalid admin role.", "ADMIN_ROLE_INVALID");
  }
  const data = await adminRepository.createAdmin({
    fullName: cleanString(req.body.fullName, 160),
    email: cleanEmail(req.body.email),
    phone: req.body.phone ? cleanPhone(req.body.phone) : null,
    password: req.body.password,
    role
  });
  await createLog("admin", req.user?.id, "admin.create", "admin_users", data.id, { role: data.role }, req.ip);
  res.status(201).json({ success: true, data });
}

async function createBackup(req, res) {
  const data = await backupService.createBackup({
    actorId: req.user?.id,
    ipAddress: req.ip
  });
  res.status(201).json({ success: true, data });
}

async function listBackups(_req, res) {
  const data = await backupService.listBackups();
  res.json({ success: true, data });
}

async function rbac(_req, res) {
  const data = await adminRepository.rbacCatalog();
  res.json({ success: true, data });
}

async function syncRbac(req, res) {
  if (!(await rbacRepository.hasPermission(req.user?.id, req.user?.role, "permissions:manage"))) {
    throw createHttpError(403, "Your admin role cannot perform this action.", "PERMISSION_DENIED");
  }

  const data = await adminRepository.syncRbacDefaults();
  await createLog("admin", req.user?.id, "rbac.sync", "permissions", null, data, req.ip);
  res.json({ success: true, data });
}

async function uploadImage(req, res) {
  const data = await imageUploadService.saveImageUpload(req.body);
  await createLog("admin", req.user?.id, "image.upload", "uploads", null, { url: data.url }, req.ip);
  res.status(201).json({ success: true, data });
}

module.exports = {
  createAdmin,
  createBackup,
  list,
  listBackups,
  overview,
  rbac,
  save,
  syncRbac,
  uploadImage
};
