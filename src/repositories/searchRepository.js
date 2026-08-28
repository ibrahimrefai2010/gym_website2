const { hasDatabaseConfig, query } = require("../config/database");
const { createHttpError } = require("../utils/httpError");

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

async function globalSearch({ q, branchId = "", limit = 8, includeSettings = false } = {}) {
  ensureDatabase();
  const term = String(q || "").trim();
  if (!term) {
    return [];
  }
  const safeLimit = Math.max(1, Math.min(Number(limit) || 8, 20));
  const like = `%${term}%`;
  const branchFilter = branchId ? " AND branch_id = ?" : "";
  const branchParams = branchId ? [branchId] : [];
  const [customers, invoices, payments, memberships, documents, settings] = await Promise.all([
    query(
      `SELECT 'customer' AS type, id, full_name AS title, CONCAT(email, ' ', phone) AS subtitle, created_at
       FROM users
       WHERE deleted_at IS NULL${branchFilter}
         AND (full_name LIKE ? OR email LIKE ? OR phone LIKE ?)
       ORDER BY created_at DESC
       LIMIT ${safeLimit}`,
      [...branchParams, like, like, like]
    ),
    query(
      `SELECT 'invoice' AS type, id, invoice_number AS title, status AS subtitle, created_at
       FROM invoices
       WHERE deleted_at IS NULL${branchFilter}
         AND invoice_number LIKE ?
       ORDER BY created_at DESC
       LIMIT ${safeLimit}`,
      [...branchParams, like]
    ),
    query(
      `SELECT 'payment' AS type, id, COALESCE(transaction_id, provider_reference, id) AS title, status AS subtitle, created_at
       FROM payments
       WHERE 1 = 1${branchFilter}
         AND (transaction_id LIKE ? OR provider_reference LIKE ?)
       ORDER BY created_at DESC
       LIMIT ${safeLimit}`,
      [...branchParams, like, like]
    ),
    query(
      `SELECT 'membership' AS type, m.id, u.full_name AS title, m.status AS subtitle, m.created_at
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE 1 = 1${branchId ? " AND m.branch_id = ?" : ""}
         AND (u.full_name LIKE ? OR m.status LIKE ?)
       ORDER BY m.created_at DESC
       LIMIT ${safeLimit}`,
      [...branchParams, like, like]
    ),
    query(
      `SELECT 'document' AS type, id, original_name AS title, category AS subtitle, created_at
       FROM documents
       WHERE deleted_at IS NULL${branchFilter}
         AND original_name LIKE ?
       ORDER BY created_at DESC
       LIMIT ${safeLimit}`,
      [...branchParams, like]
    ),
    includeSettings
      ? query(
          `SELECT 'setting' AS type, 0 AS id, key_name AS title, value AS subtitle, updated_at AS created_at
           FROM settings
           WHERE key_name LIKE ? OR value LIKE ?
           ORDER BY key_name ASC
           LIMIT ${safeLimit}`,
          [like, like]
        )
      : Promise.resolve([])
  ]);
  return [...customers, ...invoices, ...payments, ...memberships, ...documents, ...settings].slice(0, safeLimit * 4);
}

module.exports = {
  globalSearch
};
