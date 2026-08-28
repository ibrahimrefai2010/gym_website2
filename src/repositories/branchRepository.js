const { hasDatabaseConfig, query } = require("../config/database");
const { createHttpError } = require("../utils/httpError");
const { assertEnum, positiveInteger } = require("../utils/validator");

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

function mapBranch(row) {
  return {
    id: row.id,
    code: row.code,
    name: { en: row.name_en, ar: row.name_ar },
    address: { en: row.address_en || "", ar: row.address_ar || "" },
    phone: row.phone || "",
    managerId: row.manager_id,
    managerName: row.manager_name || "",
    status: row.status,
    metadata: row.metadata || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function listBranches({ search = "", status = "", page = 1, pageSize = 50 } = {}) {
  ensureDatabase();
  const where = ["b.deleted_at IS NULL"];
  const params = [];
  if (search) {
    where.push("(b.code LIKE ? OR b.name_en LIKE ? OR b.name_ar LIKE ? OR b.phone LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    where.push("b.status = ?");
    params.push(status);
  }

  const limit = positiveInteger(pageSize, 50, 100);
  const currentPage = positiveInteger(page, 1, 1000000);
  const offset = (currentPage - 1) * limit;
  const rows = await query(
    `SELECT b.*, au.full_name AS manager_name
     FROM branches b
     LEFT JOIN admin_users au ON au.id = b.manager_id
     WHERE ${where.join(" AND ")}
     ORDER BY b.status ASC, b.name_en ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const totalRows = await query(`SELECT COUNT(*) AS total FROM branches b WHERE ${where.join(" AND ")}`, params);
  return {
    items: rows.map(mapBranch),
    pagination: { page: currentPage, pageSize: limit, total: Number(totalRows[0]?.total || 0) }
  };
}

async function getBranch(id) {
  ensureDatabase();
  const rows = await query(
    `SELECT b.*, au.full_name AS manager_name
     FROM branches b
     LEFT JOIN admin_users au ON au.id = b.manager_id
     WHERE b.id = ? AND b.deleted_at IS NULL
     LIMIT 1`,
    [id]
  );
  return rows[0] ? mapBranch(rows[0]) : null;
}

async function saveBranch(payload, adminId = null) {
  ensureDatabase();
  if (payload.status) {
    assertEnum(payload.status, ["active", "inactive"], "Branch status");
  }
  const metadata = payload.metadata ? JSON.stringify(payload.metadata) : null;
  if (payload.id) {
    const result = await query(
      `UPDATE branches
       SET code = ?, name_en = ?, name_ar = ?, address_en = ?, address_ar = ?,
         phone = ?, manager_id = ?, status = ?, metadata = ?,
         updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ? AND deleted_at IS NULL`,
      [
        payload.code,
        payload.nameEn,
        payload.nameAr,
        payload.addressEn || "",
        payload.addressAr || "",
        payload.phone || "",
        payload.managerId || null,
        payload.status || "active",
        metadata,
        adminId,
        payload.id
      ]
    );
    if (result.affectedRows === 0) {
      throw createHttpError(404, "Branch not found.", "BRANCH_NOT_FOUND");
    }
    return getBranch(payload.id);
  }

  const result = await query(
    `INSERT INTO branches
      (code, name_en, name_ar, address_en, address_ar, phone, manager_id, status,
       metadata, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.code,
      payload.nameEn,
      payload.nameAr,
      payload.addressEn || "",
      payload.addressAr || "",
      payload.phone || "",
      payload.managerId || null,
      payload.status || "active",
      metadata,
      adminId,
      adminId
    ]
  );
  return getBranch(result.insertId);
}

async function deleteBranch(id, adminId = null) {
  ensureDatabase();
  const result = await query(
    `UPDATE branches
     SET status = 'inactive', deleted_at = UTC_TIMESTAMP(), updated_by = ?, updated_at = UTC_TIMESTAMP()
     WHERE id = ? AND deleted_at IS NULL`,
    [adminId, id]
  );
  if (result.affectedRows === 0) {
    throw createHttpError(404, "Branch not found.", "BRANCH_NOT_FOUND");
  }
  return { id: Number(id), deleted: true };
}

module.exports = {
  deleteBranch,
  getBranch,
  listBranches,
  saveBranch
};
