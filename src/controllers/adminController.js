const { query } = require("../config/database");
const adminRepository = require("../repositories/adminRepository");
const backupService = require("../services/backupService");
const imageUploadService = require("../services/imageUploadService");
const { createHttpError } = require("../utils/httpError");
const { env } = require("../config/env");
const { assertSaudiPhone, assertStrongPassword, cleanEmail, cleanPhone, cleanString, requireFields } = require("../utils/validator");
const { createLog } = require("../utils/logger");
const rbacRepository = require("../repositories/rbacRepository");
const planRepository = require("../repositories/planRepository");
const offerRepository = require("../repositories/offerRepository");
const { assertBranchOwnership, canSwitchBranch, resolveWriteBranchId } = require("../security/branchAccess");
const sliderRepository = require("../repositories/sliderRepository");

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
  // Reception / sales staff need to read their branch's plans to take a
  // payment; editing plans still needs plans:write (see writePermissions).
  plans: ["plans:write", "payments:write", "memberships:write"],
  rolePermissions: "permissions:manage",
  roles: "roles:manage",
  settings: "settings:write",
  siteImages: "settings:write",
  slides: "settings:write",
  users: "users:read"
};

async function overview(req, res) {
  const data = await adminRepository.getOverview(req.effectiveBranchId || req.user?.branchId || 1);
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
  const anyOf = Array.isArray(permission) ? permission : permission ? [permission] : [];
  let allowed = anyOf.length === 0;
  for (const key of anyOf) {
    if (allowed) break;
    allowed = await rbacRepository.hasPermission(req.user?.id, req.user?.role, key);
  }
  if (!allowed) {
    throw createHttpError(403, "Your admin role cannot access this resource.", "PERMISSION_DENIED");
  }

  const data = await adminRepository.listResource(req.params.resource, req.effectiveBranchId || req.user?.branchId || 1);
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
    // This generic resource endpoint reaches the very same planRepository as
    // PUT /api/v1/plans/:id (planController.update) but with the id inside
    // the body instead of the URL -- same by-id ownership gap, same fix.
    if (req.body.id) {
      const existing = await planRepository.getPlan(req.body.id);
      await assertBranchOwnership(existing, req, createHttpError(404, "Plan not found.", "PLAN_NOT_FOUND"));
    }
    const branchId = await resolveWriteBranchId(req, req.body.branchId);
    data = await adminRepository.savePlan({ ...req.body, branchId });
    await createLog("admin", req.user?.id, req.body.id ? "plan.update" : "plan.create", "plans", data?.id || req.body.id || null, null, req.ip, branchId);
  } else if (resource === "offers") {
    if (req.body.id) {
      const existing = await offerRepository.getOffer(req.body.id);
      await assertBranchOwnership(existing, req, createHttpError(404, "Offer not found.", "OFFER_NOT_FOUND"));
    }
    const branchId = await resolveWriteBranchId(req, req.body.branchId);
    data = await adminRepository.saveOffer({ ...req.body, branchId });
    await createLog("admin", req.user?.id, req.body.id ? "offer.update" : "offer.create", "offers", data?.id || req.body.id || null, null, req.ip, branchId);
  } else if (resource === "settings") {
    const branchId = await resolveWriteBranchId(req, req.body.branchId);
    data = await adminRepository.saveSetting(req.body, req.user?.id, branchId);
    await createLog("admin", req.user?.id, "settings.update", "settings", null, { key: data.key }, req.ip, branchId);
  } else if (resource === "siteImages") {
    const branchId = await resolveWriteBranchId(req, req.body.branchId);
    data = await adminRepository.saveSiteImages(req.body, req.user?.id, branchId);
    await createLog("admin", req.user?.id, "settings.images.update", "settings", null, null, req.ip, branchId);
  } else if (resource === "slides") {
    // Branch rules: a slide belongs to the admin's branch; "shared" slides
    // (branch_id NULL, shown on every site) only for cross-branch admins.
    // Updating needs ownership of the existing slide (404 otherwise).
    const switcher = await canSwitchBranch(req.user);
    if (req.body.id) {
      const existing = await sliderRepository.getSlide(req.body.id).catch(() => null);
      if (existing) {
        if (existing.shared) {
          if (!switcher) throw createHttpError(404, "Slide not found.", "SLIDE_NOT_FOUND");
        } else {
          await assertBranchOwnership(existing, req, createHttpError(404, "Slide not found.", "SLIDE_NOT_FOUND"));
        }
      }
    }
    const branchId = req.body.shared === true && switcher ? null : await resolveWriteBranchId(req, req.body.branchId);
    data = await adminRepository.saveSlide({ ...req.body, branchId });
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
    // The target admin must be in a branch this admin can act on (same 404
    // as a missing one) -- previously any permissions:manage admin could
    // re-role the other branch's staff by id.
    const targetRows = await query("SELECT id, branch_id FROM admin_users WHERE id = ? AND deleted_at IS NULL LIMIT 1", [req.body?.adminId]);
    await assertBranchOwnership(targetRows[0] || null, req, createHttpError(404, "Admin user not found.", "ADMIN_NOT_FOUND"));
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
