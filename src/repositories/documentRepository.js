const path = require("path");
const { hasDatabaseConfig, query } = require("../config/database");
const { createHttpError } = require("../utils/httpError");
const { assertEnum, positiveInteger } = require("../utils/validator");

const allowedExtensions = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".png", ".jpg", ".jpeg", ".webp", ".zip"]);
const allowedMimePrefixes = ["application/pdf", "application/zip", "image/", "application/vnd.", "text/csv", "application/msword"];
const OWNER_TYPES = ["customer", "employee", "invoice", "expense", "membership", "system"];
const CATEGORIES = ["document", "medical", "contract", "certificate", "invoice", "receipt", "image", "zip", "other"];
const VISIBILITIES = ["private", "staff", "customer"];

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

function assertSafeFile({ originalName = "", mimeType = "" }) {
  const extension = path.extname(originalName).toLowerCase();
  if (!allowedExtensions.has(extension)) {
    throw createHttpError(422, "File type is not allowed.", "FILE_TYPE_NOT_ALLOWED");
  }
  if (mimeType && !allowedMimePrefixes.some((prefix) => mimeType.startsWith(prefix))) {
    throw createHttpError(422, "File MIME type is not allowed.", "FILE_MIME_NOT_ALLOWED");
  }
}

async function listDocuments({ ownerType = "", ownerId = "", category = "", page = 1, pageSize = 25 } = {}) {
  ensureDatabase();
  const where = ["deleted_at IS NULL"];
  const params = [];
  if (ownerType) {
    where.push("owner_type = ?");
    params.push(ownerType);
  }
  if (ownerId) {
    where.push("owner_id = ?");
    params.push(ownerId);
  }
  if (category) {
    where.push("category = ?");
    params.push(category);
  }
  // Bounded server-computed integers, interpolated: mysql2 prepared
  // statements reject LIMIT ? (ER_WRONG_ARGUMENTS).
  const limit = positiveInteger(pageSize, 25, 100);
  const currentPage = positiveInteger(page, 1, 1000000);
  const offset = (currentPage - 1) * limit;
  const rows = await query(
    `SELECT id, owner_type, owner_id, category, original_name, mime_type, file_size,
      visibility, status, created_at
     FROM documents
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const totalRows = await query(`SELECT COUNT(*) AS total FROM documents WHERE ${where.join(" AND ")}`, params);
  return {
    items: rows,
    pagination: { page: currentPage, pageSize: limit, total: Number(totalRows[0]?.total || 0) }
  };
}

async function createDocument(payload, adminId = null) {
  ensureDatabase();
  assertSafeFile(payload);
  assertEnum(payload.ownerType, OWNER_TYPES, "Document owner type");
  assertEnum(payload.category || "document", CATEGORIES, "Document category");
  assertEnum(payload.visibility || "private", VISIBILITIES, "Document visibility");
  const originalName = path.basename(payload.originalName);
  const storedName = path.basename(payload.storedName || payload.originalName);
  const result = await query(
    `INSERT INTO documents
      (branch_id, owner_type, owner_id, category, original_name, stored_name,
       storage_path, mime_type, file_size, checksum, thumbnail_path, visibility,
       status, uploaded_by, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, ?)`,
    [
      payload.branchId || 1,
      payload.ownerType,
      payload.ownerId,
      payload.category || "document",
      originalName,
      storedName,
      payload.storagePath,
      payload.mimeType || "application/octet-stream",
      Number(payload.fileSize || 0),
      payload.checksum || null,
      payload.thumbnailPath || null,
      payload.visibility || "private",
      adminId,
      adminId,
      adminId
    ]
  );
  return { id: result.insertId };
}

module.exports = {
  createDocument,
  listDocuments
};
