const { hasDatabaseConfig, query, transaction } = require("../config/database");
const { createHttpError } = require("../utils/httpError");
const {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  ROLES,
  expandPermissionKeys,
  normalizeRoleKey
} = require("../security/permissions");

const CACHE_TTL_MS = 60 * 1000;
let tableStatus;
const permissionCache = new Map();

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

function isMissingRbacTable(error) {
  return error?.code === "ER_NO_SUCH_TABLE" || /Table .*roles|role_permissions|permissions|admin_user_roles/i.test(error?.message || "");
}

function fallbackPermissionKeys(role) {
  const roleKey = normalizeRoleKey(role || "staff");
  const keys = DEFAULT_ROLE_PERMISSIONS[roleKey] || [];
  return expandPermissionKeys(keys);
}

function clearCache() {
  permissionCache.clear();
}

async function hasRbacTables() {
  if (!hasDatabaseConfig()) {
    return false;
  }

  if (tableStatus && Date.now() - tableStatus.checkedAt < CACHE_TTL_MS) {
    return tableStatus.available;
  }

  try {
    await query("SELECT id FROM roles LIMIT 1");
    tableStatus = { available: true, checkedAt: Date.now() };
    return true;
  } catch (error) {
    if (isMissingRbacTable(error)) {
      tableStatus = { available: false, checkedAt: Date.now() };
      return false;
    }
    throw error;
  }
}

async function getAssignedRoleKeys(adminId) {
  if (!adminId || !(await hasRbacTables())) {
    return [];
  }

  const rows = await query(
    `SELECT r.key_name
     FROM admin_user_roles aur
     JOIN roles r ON r.id = aur.role_id
     WHERE aur.admin_user_id = ? AND r.is_active = 1
     ORDER BY r.key_name ASC`,
    [adminId]
  );
  return rows.map((row) => row.key_name);
}

async function getPermissionKeys(adminId, legacyRole) {
  const roleKey = normalizeRoleKey(legacyRole || "staff");
  const cacheKey = `${adminId || "legacy"}:${roleKey}`;
  const cached = permissionCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.permissions;
  }

  if (!(await hasRbacTables())) {
    const fallback = fallbackPermissionKeys(roleKey);
    permissionCache.set(cacheKey, { permissions: fallback, createdAt: Date.now() });
    return fallback;
  }

  const assignedRoleKeys = await getAssignedRoleKeys(adminId);
  if (assignedRoleKeys.length === 0) {
    const fallback = fallbackPermissionKeys(roleKey);
    permissionCache.set(cacheKey, { permissions: fallback, createdAt: Date.now() });
    return fallback;
  }

  const rows = await query(
    `SELECT DISTINCT p.key_name
     FROM admin_user_roles aur
     JOIN role_permissions rp ON rp.role_id = aur.role_id
     JOIN permissions p ON p.id = rp.permission_id
     JOIN roles r ON r.id = aur.role_id
     WHERE aur.admin_user_id = ?
       AND r.is_active = 1
       AND p.is_active = 1
     ORDER BY p.key_name ASC`,
    [adminId]
  );
  const permissions = rows.map((row) => row.key_name);
  permissionCache.set(cacheKey, { permissions, createdAt: Date.now() });
  return permissions;
}

async function hasPermission(adminId, legacyRole, permission) {
  if (!permission) {
    return true;
  }

  const permissions = await getPermissionKeys(adminId, legacyRole);
  return permissions.includes(permission);
}

function defaultRoles() {
  return ROLES.map((role) => ({
    key: role.key,
    displayName: role.displayName,
    description: role.description,
    isSystem: role.isSystem,
    isActive: true,
    permissionKeys: expandPermissionKeys(DEFAULT_ROLE_PERMISSIONS[role.key] || [])
  }));
}

function defaultPermissions() {
  return PERMISSIONS.map((permission) => ({
    key: permission.key,
    category: permission.category,
    description: permission.description,
    isActive: true
  }));
}

async function listPermissions() {
  if (!(await hasRbacTables())) {
    return defaultPermissions();
  }

  const rows = await query(
    `SELECT id, key_name, category, description, is_active, created_at, updated_at
     FROM permissions
     ORDER BY category ASC, key_name ASC`
  );
  return rows.map((row) => ({
    id: row.id,
    key: row.key_name,
    category: row.category,
    description: row.description,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

async function listRoles() {
  if (!(await hasRbacTables())) {
    return defaultRoles();
  }

  const rows = await query(
    `SELECT r.id, r.key_name, r.display_name, r.description, r.is_system, r.is_active,
      r.created_at, r.updated_at,
      GROUP_CONCAT(p.key_name ORDER BY p.key_name SEPARATOR ',') AS permission_keys
     FROM roles r
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     LEFT JOIN permissions p ON p.id = rp.permission_id
     GROUP BY r.id
     ORDER BY r.is_system DESC, r.display_name ASC`
  );
  return rows.map((row) => ({
    id: row.id,
    key: row.key_name,
    displayName: row.display_name,
    description: row.description,
    isSystem: Boolean(row.is_system),
    isActive: Boolean(row.is_active),
    permissionKeys: row.permission_keys ? row.permission_keys.split(",") : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

async function listAdminRoleAssignments() {
  if (!(await hasRbacTables())) {
    return [];
  }

  const rows = await query(
    `SELECT au.id AS admin_id, au.full_name, au.email,
      GROUP_CONCAT(r.key_name ORDER BY r.key_name SEPARATOR ',') AS role_keys
     FROM admin_users au
     LEFT JOIN admin_user_roles aur ON aur.admin_user_id = au.id
     LEFT JOIN roles r ON r.id = aur.role_id
     WHERE au.deleted_at IS NULL
     GROUP BY au.id
     ORDER BY au.created_at DESC`
  );
  return rows.map((row) => ({
    adminId: row.admin_id,
    fullName: row.full_name,
    email: row.email,
    roleKeys: row.role_keys ? row.role_keys.split(",") : []
  }));
}

async function saveRole(payload) {
  ensureDatabase();
  if (!(await hasRbacTables())) {
    throw createHttpError(503, "Run database migrations before managing roles.", "RBAC_MIGRATION_REQUIRED");
  }

  const key = normalizeRoleKey(payload.key || payload.keyName || payload.name);
  if (!key) {
    throw createHttpError(422, "Role key is required.", "ROLE_KEY_REQUIRED");
  }

  const displayName = String(payload.displayName || payload.name || key).trim().slice(0, 120);
  const description = String(payload.description || "").trim().slice(0, 500);
  const isActive = payload.isActive !== false;

  await query(
    `INSERT INTO roles (key_name, display_name, description, is_system, is_active)
     VALUES (?, ?, ?, 0, ?)
     ON DUPLICATE KEY UPDATE
       display_name = VALUES(display_name),
       description = VALUES(description),
       is_active = VALUES(is_active),
       updated_at = UTC_TIMESTAMP()`,
    [key, displayName, description, isActive]
  );
  clearCache();
  const roles = await listRoles();
  return roles.find((role) => role.key === key);
}

async function savePermission(payload) {
  ensureDatabase();
  if (!(await hasRbacTables())) {
    throw createHttpError(503, "Run database migrations before managing permissions.", "RBAC_MIGRATION_REQUIRED");
  }

  const key = String(payload.key || payload.keyName || "").trim().toLowerCase().slice(0, 120);
  if (!/^[a-z0-9_]+:[a-z0-9_]+$/.test(key)) {
    throw createHttpError(422, "Permission key must look like resource:action.", "PERMISSION_KEY_INVALID");
  }

  const category = String(payload.category || "Custom").trim().slice(0, 80);
  const description = String(payload.description || "").trim().slice(0, 500);
  const isActive = payload.isActive !== false;

  await query(
    `INSERT INTO permissions (key_name, category, description, is_active)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       category = VALUES(category),
       description = VALUES(description),
       is_active = VALUES(is_active),
       updated_at = UTC_TIMESTAMP()`,
    [key, category, description, isActive]
  );
  clearCache();
  const permissions = await listPermissions();
  return permissions.find((permission) => permission.key === key);
}

async function setRolePermissions({ roleKey, permissionKeys, grantedBy = null }) {
  ensureDatabase();
  if (!(await hasRbacTables())) {
    throw createHttpError(503, "Run database migrations before managing permissions.", "RBAC_MIGRATION_REQUIRED");
  }

  const normalizedRoleKey = normalizeRoleKey(roleKey);
  const keys = [...new Set((permissionKeys || []).map((key) => String(key).trim()).filter(Boolean))];
  return transaction(async (connection) => {
    const [roleRows] = await connection.execute("SELECT id FROM roles WHERE key_name = ? LIMIT 1", [normalizedRoleKey]);
    if (!roleRows[0]) {
      throw createHttpError(404, "Role not found.", "ROLE_NOT_FOUND");
    }

    let permissionRows = [];
    if (keys.length > 0) {
      const placeholders = keys.map(() => "?").join(",");
      const [rows] = await connection.execute(
        `SELECT id, key_name FROM permissions WHERE key_name IN (${placeholders}) AND is_active = 1`,
        keys
      );
      permissionRows = rows;
    }

    await connection.execute("DELETE FROM role_permissions WHERE role_id = ?", [roleRows[0].id]);
    for (const permission of permissionRows) {
      await connection.execute(
        `INSERT INTO role_permissions (role_id, permission_id, granted_by)
         VALUES (?, ?, ?)`,
        [roleRows[0].id, permission.id, grantedBy]
      );
    }

    clearCache();
    return {
      roleKey: normalizedRoleKey,
      permissionKeys: permissionRows.map((permission) => permission.key_name)
    };
  });
}

async function setAdminRoles({ adminId, roleKeys, grantedBy = null }) {
  ensureDatabase();
  if (!(await hasRbacTables())) {
    throw createHttpError(503, "Run database migrations before assigning roles.", "RBAC_MIGRATION_REQUIRED");
  }

  const targetAdminId = Number(adminId);
  const keys = [...new Set((roleKeys || []).map(normalizeRoleKey).filter(Boolean))];
  if (!targetAdminId || keys.length === 0) {
    throw createHttpError(422, "Admin id and at least one role are required.", "ADMIN_ROLE_ASSIGNMENT_INVALID");
  }

  return transaction(async (connection) => {
    const [adminRows] = await connection.execute(
      "SELECT id FROM admin_users WHERE id = ? AND deleted_at IS NULL LIMIT 1",
      [targetAdminId]
    );
    if (!adminRows[0]) {
      throw createHttpError(404, "Admin user not found.", "ADMIN_NOT_FOUND");
    }

    const placeholders = keys.map(() => "?").join(",");
    const [roleRows] = await connection.execute(
      `SELECT id, key_name FROM roles WHERE key_name IN (${placeholders}) AND is_active = 1`,
      keys
    );
    if (roleRows.length !== keys.length) {
      throw createHttpError(422, "One or more roles are invalid.", "ROLE_ASSIGNMENT_INVALID");
    }

    await connection.execute("DELETE FROM admin_user_roles WHERE admin_user_id = ?", [targetAdminId]);
    for (const role of roleRows) {
      await connection.execute(
        `INSERT INTO admin_user_roles (admin_user_id, role_id, granted_by)
         VALUES (?, ?, ?)`,
        [targetAdminId, role.id, grantedBy]
      );
    }

    clearCache();
    return {
      adminId: targetAdminId,
      roleKeys: roleRows.map((role) => role.key_name)
    };
  });
}

async function syncDefaults({ backfill = false } = {}) {
  ensureDatabase();
  if (!(await hasRbacTables())) {
    throw createHttpError(503, "Run RBAC table migration before syncing defaults.", "RBAC_MIGRATION_REQUIRED");
  }

  for (const role of ROLES) {
    await query(
      `INSERT INTO roles (key_name, display_name, description, is_system, is_active)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         description = VALUES(description),
         is_system = VALUES(is_system),
         updated_at = UTC_TIMESTAMP()`,
      [role.key, role.displayName, role.description, Boolean(role.isSystem)]
    );
  }

  for (const permission of PERMISSIONS) {
    await query(
      `INSERT INTO permissions (key_name, category, description, is_active)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         category = VALUES(category),
         description = VALUES(description),
         updated_at = UTC_TIMESTAMP()`,
      [permission.key, permission.category, permission.description]
    );
  }

  for (const [roleKey, permissionKeys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const expandedKeys = expandPermissionKeys(permissionKeys);
    for (const permissionKey of expandedKeys) {
      await query(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id)
         SELECT r.id, p.id
         FROM roles r
         JOIN permissions p ON p.key_name = ?
         WHERE r.key_name = ?`,
        [permissionKey, roleKey]
      );
    }
  }

  if (backfill) {
    await query(
      `INSERT IGNORE INTO admin_user_roles (admin_user_id, role_id)
       SELECT au.id, r.id
       FROM admin_users au
       JOIN roles r ON r.key_name = au.role
       WHERE au.deleted_at IS NULL`
    );
  }

  tableStatus = { available: true, checkedAt: Date.now() };
  clearCache();
  return {
    roles: ROLES.length,
    permissions: ALL_PERMISSION_KEYS.length,
    backfilledAssignments: Boolean(backfill)
  };
}

async function getCatalog() {
  const [roles, permissions, assignments] = await Promise.all([
    listRoles(),
    listPermissions(),
    listAdminRoleAssignments()
  ]);
  return { roles, permissions, assignments };
}

module.exports = {
  clearCache,
  getAssignedRoleKeys,
  getCatalog,
  getPermissionKeys,
  hasPermission,
  hasRbacTables,
  listAdminRoleAssignments,
  listPermissions,
  listRoles,
  savePermission,
  saveRole,
  setAdminRoles,
  setRolePermissions,
  syncDefaults
};
