const { hasDatabaseConfig, query } = require("../config/database");
const { createHttpError } = require("../utils/httpError");
const { assertEnum, assertPositiveNumber, positiveInteger } = require("../utils/validator");

const EXPENSE_STATUSES = ["draft", "pending", "approved", "rejected", "paid", "cancelled"];

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

async function listCategories() {
  ensureDatabase();
  return query("SELECT id, code, name_en, name_ar, is_active FROM expense_categories WHERE deleted_at IS NULL ORDER BY name_en ASC");
}

async function listExpenses({ page = 1, pageSize = 25, branchId = "", categoryId = "", status = "", dateFrom = "", dateTo = "" } = {}) {
  ensureDatabase();
  const where = ["e.deleted_at IS NULL"];
  const params = [];
  if (branchId) {
    where.push("e.branch_id = ?");
    params.push(branchId);
  }
  if (categoryId) {
    where.push("e.category_id = ?");
    params.push(categoryId);
  }
  if (status) {
    where.push("e.status = ?");
    params.push(status);
  }
  if (dateFrom) {
    where.push("e.expense_date >= ?");
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push("e.expense_date <= ?");
    params.push(dateTo);
  }
  // Bounded server-computed integers, interpolated: mysql2 prepared
  // statements reject LIMIT ? (ER_WRONG_ARGUMENTS).
  const limit = positiveInteger(pageSize, 25, 100);
  const currentPage = positiveInteger(page, 1, 1000000);
  const offset = (currentPage - 1) * limit;
  const rows = await query(
    `SELECT e.*, c.name_en AS category, b.name_en AS branch
     FROM expenses e
     LEFT JOIN expense_categories c ON c.id = e.category_id
     LEFT JOIN branches b ON b.id = e.branch_id
     WHERE ${where.join(" AND ")}
     ORDER BY e.expense_date DESC, e.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const totalRows = await query(`SELECT COUNT(*) AS total FROM expenses e WHERE ${where.join(" AND ")}`, params);
  return {
    items: rows,
    pagination: { page: currentPage, pageSize: limit, total: Number(totalRows[0]?.total || 0) }
  };
}

async function createExpense(payload, adminId = null) {
  ensureDatabase();
  const amount = assertPositiveNumber(payload.amount, "Expense amount");
  if (payload.status) {
    assertEnum(payload.status, EXPENSE_STATUSES, "Expense status");
  }
  const result = await query(
    `INSERT INTO expenses
      (branch_id, category_id, employee_id, title, description, amount, currency,
       expense_date, status, metadata, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.branchId || 1,
      payload.categoryId || null,
      payload.employeeId || null,
      payload.title,
      payload.description || null,
      amount,
      payload.currency || "SAR",
      payload.expenseDate || new Date().toISOString().slice(0, 10),
      payload.status || "pending",
      payload.metadata ? JSON.stringify(payload.metadata) : null,
      adminId,
      adminId
    ]
  );
  return { id: result.insertId };
}

async function updateExpense(id, payload, adminId = null) {
  ensureDatabase();
  if (payload.status) {
    assertEnum(payload.status, EXPENSE_STATUSES, "Expense status");
  }
  const amount = payload.amount === undefined || payload.amount === null || payload.amount === ""
    ? null
    : assertPositiveNumber(payload.amount, "Expense amount");
  const result = await query(
    `UPDATE expenses
     SET category_id = COALESCE(?, category_id), title = COALESCE(?, title),
       description = COALESCE(?, description), amount = COALESCE(?, amount),
       expense_date = COALESCE(?, expense_date), status = COALESCE(?, status),
       approved_by = COALESCE(?, approved_by),
       approved_at = CASE WHEN ? IS NOT NULL THEN UTC_TIMESTAMP() ELSE approved_at END,
       updated_by = ?, updated_at = UTC_TIMESTAMP()
     WHERE id = ? AND deleted_at IS NULL`,
    [
      payload.categoryId || null,
      payload.title || null,
      payload.description || null,
      amount,
      payload.expenseDate || null,
      payload.status || null,
      payload.status === "approved" ? adminId : null,
      payload.status === "approved" ? adminId : null,
      adminId,
      id
    ]
  );
  if (result.affectedRows === 0) {
    throw createHttpError(404, "Expense not found.", "EXPENSE_NOT_FOUND");
  }
  return { id: Number(id), updated: true };
}

// For by-id ownership checks (expenseController.update).
async function getExpenseBranch(id) {
  ensureDatabase();
  const rows = await query("SELECT id, branch_id FROM expenses WHERE id = ? AND deleted_at IS NULL LIMIT 1", [id]);
  return rows[0] || null;
}

module.exports = {
  getExpenseBranch,
  createExpense,
  listCategories,
  listExpenses,
  updateExpense
};
