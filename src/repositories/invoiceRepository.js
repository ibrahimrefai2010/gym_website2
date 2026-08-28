const { hasDatabaseConfig, query, transaction } = require("../config/database");
const { createHttpError } = require("../utils/httpError");
const { assertEnum, positiveInteger } = require("../utils/validator");

const INVOICE_STATUSES = ["draft", "pending", "paid", "partial", "cancelled", "refunded"];

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

function invoiceNumber() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `INV-${stamp}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function lineTotals(item) {
  const quantity = Number(item.quantity || 1);
  const unitPrice = Number(item.unitPrice || item.unit_price || 0);
  const discount = Number(item.discount || 0);
  const taxRate = Number(item.taxRate || item.tax_rate || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw createHttpError(422, "Invoice item quantity must be positive.", "INVOICE_ITEM_QUANTITY_INVALID");
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw createHttpError(422, "Invoice item unit price is invalid.", "INVOICE_ITEM_PRICE_INVALID");
  }
  if (!Number.isFinite(discount) || discount < 0) {
    throw createHttpError(422, "Invoice item discount is invalid.", "INVOICE_ITEM_DISCOUNT_INVALID");
  }
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
    throw createHttpError(422, "Invoice item tax rate is invalid.", "INVOICE_ITEM_TAX_INVALID");
  }
  const taxable = Math.max(quantity * unitPrice - discount, 0);
  const taxAmount = Number(((taxable * taxRate) / 100).toFixed(2));
  return {
    quantity,
    unitPrice,
    discount,
    taxRate,
    taxAmount,
    lineTotal: Number((taxable + taxAmount).toFixed(2))
  };
}

async function listInvoices({ page = 1, pageSize = 25, branchId = "", userId = "", status = "", dateFrom = "", dateTo = "", search = "" } = {}) {
  ensureDatabase();
  const where = ["i.deleted_at IS NULL"];
  const params = [];
  if (branchId) {
    where.push("i.branch_id = ?");
    params.push(branchId);
  }
  if (userId) {
    where.push("i.user_id = ?");
    params.push(userId);
  }
  if (status) {
    where.push("i.status = ?");
    params.push(status);
  }
  if (dateFrom) {
    where.push("i.issue_date >= ?");
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push("i.issue_date <= ?");
    params.push(dateTo);
  }
  if (search) {
    where.push("(i.invoice_number LIKE ? OR u.full_name LIKE ? OR u.phone LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const limit = positiveInteger(pageSize, 25, 100);
  const currentPage = positiveInteger(page, 1, 1000000);
  const offset = (currentPage - 1) * limit;
  const rows = await query(
    `SELECT i.id, i.invoice_number, i.status, i.issue_date, i.due_date, i.total,
      i.paid_total, i.balance_due, i.currency, u.full_name AS customer, b.name_en AS branch
     FROM invoices i
     JOIN users u ON u.id = i.user_id
     LEFT JOIN branches b ON b.id = i.branch_id
     WHERE ${where.join(" AND ")}
     ORDER BY i.issue_date DESC, i.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const totalRows = await query(
    `SELECT COUNT(*) AS total FROM invoices i JOIN users u ON u.id = i.user_id WHERE ${where.join(" AND ")}`,
    params
  );
  return {
    items: rows,
    pagination: { page: currentPage, pageSize: limit, total: Number(totalRows[0]?.total || 0) }
  };
}

async function getInvoice(id) {
  ensureDatabase();
  const [invoiceRows, items] = await Promise.all([
    query(
      `SELECT i.*, u.full_name AS customer, u.email, u.phone, b.name_en AS branch
       FROM invoices i
       JOIN users u ON u.id = i.user_id
       LEFT JOIN branches b ON b.id = i.branch_id
       WHERE i.id = ? AND i.deleted_at IS NULL
       LIMIT 1`,
      [id]
    ),
    query("SELECT * FROM invoice_items WHERE invoice_id = ? AND deleted_at IS NULL ORDER BY id ASC", [id])
  ]);
  return invoiceRows[0] ? { invoice: invoiceRows[0], items } : null;
}

async function createInvoice(payload, adminId = null) {
  ensureDatabase();
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) {
    throw createHttpError(422, "Invoice must include at least one item.", "INVOICE_ITEMS_REQUIRED");
  }
  if (payload.status) {
    assertEnum(payload.status, INVOICE_STATUSES, "Invoice status");
  }

  const prepared = items.map((item) => ({ ...item, totals: lineTotals(item) }));
  const subtotal = prepared.reduce((sum, item) => sum + item.totals.quantity * item.totals.unitPrice, 0);
  const discountTotal = prepared.reduce((sum, item) => sum + item.totals.discount, 0);
  const taxTotal = prepared.reduce((sum, item) => sum + item.totals.taxAmount, 0);
  const total = prepared.reduce((sum, item) => sum + item.totals.lineTotal, 0);
  const paidTotal = Number(payload.paidTotal || 0);
  const balanceDue = Math.max(total - paidTotal, 0);
  const status = payload.status || (paidTotal >= total ? "paid" : paidTotal > 0 ? "partial" : "pending");

  return transaction(async (connection) => {
    const [result] = await connection.execute(
      `INSERT INTO invoices
        (branch_id, user_id, membership_id, invoice_number, status, issue_date, due_date,
         subtotal, discount_total, tax_total, total, paid_total, balance_due, currency,
         notes, metadata, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.branchId || 1,
        payload.userId,
        payload.membershipId || null,
        payload.invoiceNumber || invoiceNumber(),
        status,
        payload.issueDate || new Date().toISOString().slice(0, 10),
        payload.dueDate || null,
        subtotal,
        discountTotal,
        taxTotal,
        total,
        paidTotal,
        balanceDue,
        payload.currency || "SAR",
        payload.notes || null,
        payload.metadata ? JSON.stringify(payload.metadata) : null,
        adminId,
        adminId
      ]
    );

    for (const item of prepared) {
      await connection.execute(
        `INSERT INTO invoice_items
          (invoice_id, plan_id, item_type, description, quantity, unit_price, discount,
           tax_rate, tax_amount, line_total, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          result.insertId,
          item.planId || null,
          item.itemType || "other",
          item.description,
          item.totals.quantity,
          item.totals.unitPrice,
          item.totals.discount,
          item.totals.taxRate,
          item.totals.taxAmount,
          item.totals.lineTotal,
          adminId,
          adminId
        ]
      );
    }
    return { id: result.insertId };
  });
}

async function updateInvoiceStatus(id, status, adminId = null) {
  ensureDatabase();
  assertEnum(status, INVOICE_STATUSES, "Invoice status");
  const result = await query(
    "UPDATE invoices SET status = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND deleted_at IS NULL",
    [status, adminId, id]
  );
  if (result.affectedRows === 0) {
    throw createHttpError(404, "Invoice not found.", "INVOICE_NOT_FOUND");
  }
  return getInvoice(id);
}

module.exports = {
  createInvoice,
  getInvoice,
  listInvoices,
  updateInvoiceStatus
};
