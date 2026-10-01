// Admin / staff account management (Part 2 §2.0.9).
//
//  - Lists and edits admins of the current (server-derived) branch only; a
//    cross-branch admin sees the branch they are switched to.
//  - New accounts get a one-time temporary password and must change it at
//    first sign-in (admin_users.must_change_password). Resetting a password
//    does the same and revokes the account's sessions.
//  - Only a super_admin may create, edit or reset a super_admin, or grant
//    the super_admin role. Nobody can deactivate or demote themselves.
//  - Roles are the granular RBAC roles (rbacRepository.setAdminRoles).

const crypto = require("crypto");
const { query, transaction } = require("../config/database");
const rbacRepository = require("../repositories/rbacRepository");
const { assertBranchOwnership, canSwitchBranch, resolveWriteBranchId } = require("../security/branchAccess");
const { hashPassword } = require("../utils/hash");
const { cleanEmail, cleanPhone, cleanString, isSaudiPhone } = require("../utils/validator");
const { createHttpError } = require("../utils/httpError");
const { createLog } = require("../utils/logger");

const notFound = () => createHttpError(404, "Staff account not found.", "STAFF_NOT_FOUND");

function temporaryPassword() {
  // Meets assertStrongPassword: upper, lower, digit, symbol.
  return `Mf!${crypto.randomBytes(9).toString("base64url")}9a`;
}

async function getStaff(id) {
  const rows = await query(
    `SELECT id, branch_id, full_name, email, phone, role, status, must_change_password, last_login_at, last_login_ip, created_at
     FROM admin_users WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

function mapStaff(row, roleKeys = []) {
  return {
    id: row.id,
    branchId: Number(row.branch_id),
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    legacyRole: row.role,
    roleKeys,
    status: row.status,
    mustChangePassword: Boolean(row.must_change_password),
    lastLoginAt: row.last_login_at,
    lastLoginIp: row.last_login_ip,
    createdAt: row.created_at
  };
}

function assertCanTouch(req, target) {
  if (target.role === "super_admin" && req.user.role !== "super_admin") {
    throw createHttpError(403, "Only a super admin can change a super admin account.", "STAFF_SUPER_ONLY");
  }
}

function assertRoleGrant(req, roleKeys) {
  if (roleKeys.includes("super_admin") && req.user.role !== "super_admin") {
    throw createHttpError(403, "Only a super admin can grant the super admin role.", "STAFF_SUPER_ONLY");
  }
}

function cleanRoleKeys(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((key) => cleanString(key, 60)).filter(Boolean))];
}

async function list(req, res) {
  if (!req.effectiveBranchId) throw createHttpError(403, "No branch in scope.", "BRANCH_REQUIRED");
  const rows = await query(
    `SELECT id, branch_id, full_name, email, phone, role, status, must_change_password, last_login_at, last_login_ip, created_at
     FROM admin_users WHERE deleted_at IS NULL AND branch_id = ? ORDER BY full_name ASC`,
    [req.effectiveBranchId]
  );
  const items = [];
  for (const row of rows) items.push(mapStaff(row, await rbacRepository.getAssignedRoleKeys(row.id)));
  res.json({ success: true, data: items });
}

async function create(req, res) {
  const fullName = cleanString(req.body?.fullName, 160);
  const email = cleanEmail(req.body?.email);
  const phone = req.body?.phone ? cleanPhone(req.body.phone) : null;
  const roleKeys = cleanRoleKeys(req.body?.roleKeys);
  if (fullName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createHttpError(422, "Enter a name and a valid email.", "STAFF_FIELDS_REQUIRED");
  }
  if (phone && !isSaudiPhone(phone)) throw createHttpError(422, "Enter a valid Saudi mobile number.", "INVALID_PHONE");
  if (!roleKeys.length) throw createHttpError(422, "Choose at least one role.", "STAFF_ROLE_REQUIRED");
  assertRoleGrant(req, roleKeys);
  const branchId = await resolveWriteBranchId(req, req.body?.branchId);
  const password = temporaryPassword();
  let id;
  try {
    const result = await query(
      `INSERT INTO admin_users (branch_id, full_name, email, phone, password_hash, role, status, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, 'active', 1)`,
      [branchId, fullName, email, phone, await hashPassword(password), roleKeys.includes("super_admin") ? "super_admin" : "staff"]
    );
    id = result.insertId;
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") throw createHttpError(409, "An admin with this email already exists.", "ADMIN_EXISTS");
    throw error;
  }
  await rbacRepository.setAdminRoles({ adminId: id, roleKeys, grantedBy: req.user.id });
  await createLog("admin", req.user.id, "staff.create", "admin_users", id, { roleKeys, branchId }, req.ip, branchId);
  res.status(201).json({ success: true, data: { ...mapStaff(await getStaff(id), roleKeys), temporaryPassword: password } });
}

async function update(req, res) {
  const target = await getStaff(req.params.id);
  await assertBranchOwnership(target, req, notFound());
  assertCanTouch(req, target);
  const isSelf = Number(target.id) === Number(req.user.id);
  const changes = {};
  if (req.body?.fullName !== undefined) changes.full_name = cleanString(req.body.fullName, 160);
  if (req.body?.phone !== undefined) {
    const phone = req.body.phone ? cleanPhone(req.body.phone) : null;
    if (phone && !isSaudiPhone(phone)) throw createHttpError(422, "Enter a valid Saudi mobile number.", "INVALID_PHONE");
    changes.phone = phone;
  }
  if (req.body?.status !== undefined) {
    if (!["active", "inactive", "suspended"].includes(req.body.status)) throw createHttpError(422, "Invalid status.", "STAFF_STATUS_INVALID");
    if (isSelf && req.body.status !== "active") throw createHttpError(422, "You cannot deactivate your own account.", "STAFF_SELF_DEACTIVATE");
    changes.status = req.body.status;
  }
  if (req.body?.branchId !== undefined && (await canSwitchBranch(req.user))) {
    changes.branch_id = await resolveWriteBranchId(req, req.body.branchId);
  }
  const roleKeys = req.body?.roleKeys !== undefined ? cleanRoleKeys(req.body.roleKeys) : null;
  if (roleKeys) {
    if (!roleKeys.length) throw createHttpError(422, "Choose at least one role.", "STAFF_ROLE_REQUIRED");
    assertRoleGrant(req, roleKeys);
    if (isSelf && !roleKeys.some((key) => ["super_admin", "admin"].includes(key)) && req.user.role === "super_admin") {
      throw createHttpError(422, "You cannot remove your own super admin access.", "STAFF_SELF_DEMOTE");
    }
  }
  const before = mapStaff(target, await rbacRepository.getAssignedRoleKeys(target.id));
  await transaction(async (connection) => {
    const keys = Object.keys(changes);
    if (keys.length) {
      await connection.execute(
        `UPDATE admin_users SET ${keys.map((key) => `${key} = ?`).join(", ")}, updated_at = UTC_TIMESTAMP() WHERE id = ?`,
        [...keys.map((key) => changes[key]), target.id]
      );
    }
    if (changes.status && changes.status !== "active") {
      await connection.execute("UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE admin_user_id = ? AND revoked_at IS NULL", [target.id]);
    }
  });
  if (roleKeys) await rbacRepository.setAdminRoles({ adminId: target.id, roleKeys, grantedBy: req.user.id });
  const after = mapStaff(await getStaff(target.id), await rbacRepository.getAssignedRoleKeys(target.id));
  await createLog("admin", req.user.id, "staff.update", "admin_users", target.id, { before, after }, req.ip, after.branchId);
  res.json({ success: true, data: after });
}

async function resetPassword(req, res) {
  const target = await getStaff(req.params.id);
  await assertBranchOwnership(target, req, notFound());
  assertCanTouch(req, target);
  const password = temporaryPassword();
  await transaction(async (connection) => {
    await connection.execute(
      "UPDATE admin_users SET password_hash = ?, must_change_password = 1, updated_at = UTC_TIMESTAMP() WHERE id = ?",
      [await hashPassword(password), target.id]
    );
    await connection.execute("UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE admin_user_id = ? AND revoked_at IS NULL", [target.id]);
  });
  await createLog("admin", req.user.id, "staff.password_reset", "admin_users", target.id, null, req.ip, target.branch_id);
  res.json({ success: true, data: { id: target.id, temporaryPassword: password } });
}

module.exports = { create, list, resetPassword, update };
