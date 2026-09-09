const { hasDatabaseConfig, query, transaction } = require("../config/database");
const { createHttpError } = require("../utils/httpError");
const { assertEnum, positiveInteger } = require("../utils/validator");
const { hijriYear } = require("../utils/hijri");
const { buildZatcaQrBase64 } = require("../utils/zatcaQr");
const businessSettingsRepository = require("./businessSettingsRepository");

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

async function resolveBuyer(payload) {
  const name = payload.buyerName ? String(payload.buyerName).trim().slice(0, 200) : null;
  const phone = payload.buyerPhone ? String(payload.buyerPhone).trim().slice(0, 40) : null;
  const vatNumber = payload.buyerVatNumber ? String(payload.buyerVatNumber).trim().slice(0, 20) : null;
  if (name && phone) {
    return { name, phone, vatNumber };
  }
  const rows = await query("SELECT full_name, phone FROM users WHERE id = ? LIMIT 1", [payload.userId]);
  return {
    name: name || rows[0]?.full_name || null,
    phone: phone || rows[0]?.phone || null,
    vatNumber
  };
}

const INVOICE_STATUSES = ["draft", "pending", "paid", "partial", "cancelled", "refunded"];

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

// ZATCA requires a gap-free sequence. Owner decision: reset per Hijri year.
// The counter row is locked and incremented inside the same transaction as the
// invoice INSERT, so a rollback also rolls back the number -> no gaps, no reuse.
async function allocateInvoiceNumber(connection, issuedAt) {
  const year = hijriYear(issuedAt);
  await connection.execute(
    `INSERT INTO invoice_counters (hijri_year, last_seq) VALUES (?, 1)
     ON DUPLICATE KEY UPDATE last_seq = last_seq + 1`,
    [year]
  );
  const [rows] = await connection.execute(
    "SELECT last_seq FROM invoice_counters WHERE hijri_year = ? FOR UPDATE",
    [year]
  );
  const seq = Number(rows[0].last_seq);
  return { year, seq, number: `INV-${year}-${String(seq).padStart(6, "0")}` };
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
  const subtotal = round2(prepared.reduce((sum, item) => sum + item.totals.quantity * item.totals.unitPrice, 0));
  const discountTotal = round2(prepared.reduce((sum, item) => sum + item.totals.discount, 0));
  const taxTotal = round2(prepared.reduce((sum, item) => sum + item.totals.taxAmount, 0));
  const total = round2(prepared.reduce((sum, item) => sum + item.totals.lineTotal, 0));
  const paidTotal = round2(Number(payload.paidTotal || 0));
  const balanceDue = Math.max(round2(total - paidTotal), 0);
  const status = payload.status || (paidTotal >= total ? "paid" : paidTotal > 0 ? "partial" : "pending");

  const issuedAt = payload.issuedAt ? new Date(payload.issuedAt) : new Date();
  const issueDate = payload.issueDate || issuedAt.toISOString().slice(0, 10);

  // ZATCA Phase 1 QR — seller identity comes from business_settings.
  const seller = await businessSettingsRepository.get();
  if (!seller || !/^\d{15}$/.test(String(seller.vatNumber || ""))) {
    throw createHttpError(
      422,
      "Set the 15-digit VAT number in Admin -> Settings -> Business Info before issuing invoices.",
      "BUSINESS_VAT_NOT_CONFIGURED"
    );
  }
  const zatcaQr = buildZatcaQrBase64({
    sellerName: seller.legalEntityNameAr || seller.legalEntityNameEn,
    vatNumber: seller.vatNumber,
    timestamp: issuedAt,
    invoiceTotal: total,
    vatTotal: taxTotal
  });

  const buyer = await resolveBuyer(payload);

  return transaction(async (connection) => {
    const allocated = payload.invoiceNumber
      ? { number: payload.invoiceNumber, year: null, seq: null }
      : await allocateInvoiceNumber(connection, issuedAt);

    const [result] = await connection.execute(
      `INSERT INTO invoices
        (branch_id, user_id, membership_id, invoice_number, status, issue_date, issued_at,
         hijri_year, invoice_seq, due_date,
         subtotal, discount_total, tax_total, total, paid_total, balance_due, currency,
         buyer_name, buyer_phone, buyer_vat_number, zatca_qr,
         notes, metadata, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.branchId || 1,
        payload.userId,
        payload.membershipId || null,
        allocated.number,
        status,
        issueDate,
        issuedAt.toISOString().slice(0, 19).replace("T", " "),
        allocated.year,
        allocated.seq,
        payload.dueDate || null,
        subtotal,
        discountTotal,
        taxTotal,
        total,
        paidTotal,
        balanceDue,
        payload.currency || "SAR",
        buyer.name,
        buyer.phone,
        buyer.vatNumber,
        zatcaQr,
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
    return { id: result.insertId, invoiceNumber: allocated.number };
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
