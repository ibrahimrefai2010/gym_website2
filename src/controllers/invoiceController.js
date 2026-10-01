const excelExportService = require("../services/excelExportService");
const invoiceRepository = require("../repositories/invoiceRepository");
const invoicePdfService = require("../services/invoicePdfService");
const userRepository = require("../repositories/userRepository");
const { assertBranchOwnership } = require("../security/branchAccess");
const { createHttpError } = require("../utils/httpError");
const { createLog } = require("../utils/logger");
const { cleanString, pagination, requireFields } = require("../utils/validator");

function invoiceNotFoundError() {
  return createHttpError(404, "Invoice not found.", "INVOICE_NOT_FOUND");
}

async function list(req, res) {
  // branchId is server-derived (req.effectiveBranchId), NOT taken from the
  // query string -- previously ?branchId= was forwarded to
  // invoiceRepository.listInvoices as-is (and an absent branchId meant "all
  // branches, no filter"), so any admin could list every branch's invoices
  // just by omitting the param, or another branch's by naming it. Same bug
  // class as the by-id gap this phase fixes, just at the list level. See
  // customerController.list for the established correct pattern.
  const data = await invoiceRepository.listInvoices({
    ...pagination(req.query),
    branchId: req.effectiveBranchId || "",
    userId: cleanString(req.query.userId, 20),
    status: cleanString(req.query.status, 20),
    dateFrom: cleanString(req.query.dateFrom, 20),
    dateTo: cleanString(req.query.dateTo, 20),
    search: cleanString(req.query.search, 120)
  });
  res.json({ success: true, data });
}

async function detail(req, res) {
  const data = await invoiceRepository.getInvoice(req.params.id);
  await assertBranchOwnership(data?.invoice, req, invoiceNotFoundError());
  res.json({ success: true, data });
}

async function create(req, res) {
  requireFields(req.body, ["userId"]);
  // branchId previously came straight from payload.branchId (defaulting to
  // Main) inside invoiceRepository.createInvoice -- a client-supplied value
  // with no check at all against either the buyer's real branch or the
  // requesting admin's own branch. An invoice always belongs to whichever
  // branch its buyer belongs to, so that's derived server-side from the
  // buyer's own row, and the admin must actually control that branch (same
  // ownership rule as everywhere else in this file) to bill them at all --
  // this also stops a branch-scoped admin from invoicing another branch's
  // customer merely by naming their userId.
  const buyer = await userRepository.findById(req.body.userId);
  await assertBranchOwnership(buyer, req, createHttpError(404, "Customer not found.", "CUSTOMER_NOT_FOUND"));

  const data = await invoiceRepository.createInvoice({ ...req.body, branchId: buyer.branch_id }, req.user?.id);
  await createLog("admin", req.user?.id, "invoice.create", "invoices", data.id, null, req.ip);
  res.status(201).json({ success: true, data: await invoiceRepository.getInvoice(data.id) });
}

async function updateStatus(req, res) {
  const existing = await invoiceRepository.getInvoice(req.params.id);
  await assertBranchOwnership(existing?.invoice, req, invoiceNotFoundError());

  const status = cleanString(req.body.status, 20);
  const data = await invoiceRepository.updateInvoiceStatus(req.params.id, status, req.user?.id);
  await createLog("admin", req.user?.id, "invoice.status.update", "invoices", req.params.id, { status }, req.ip);
  res.json({ success: true, data });
}

async function overdue(req, res) {
  const data = await invoiceRepository.overdueInvoices({
    branchId: req.effectiveBranchId || "",
    asOf: cleanString(req.query.asOf, 20)
  });
  res.json({ success: true, data });
}

async function pdf(req, res) {
  const existing = await invoiceRepository.getInvoice(req.params.id);
  await assertBranchOwnership(existing?.invoice, req, invoiceNotFoundError());

  const buffer = await invoicePdfService.renderInvoicePdf(req.params.id);
  await invoiceRepository.markPdfGenerated(req.params.id).catch(() => {});
  await createLog("admin", req.user?.id, "invoice.pdf", "invoices", req.params.id, null, req.ip);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="invoice-${req.params.id}.pdf"`);
  res.send(buffer);
}

const INVOICE_EXPORT_COLUMNS = [
  { key: "invoice_number", en: "Invoice #", ar: "رقم الفاتورة", width: 20 },
  { key: "issued_at", en: "Issued", ar: "تاريخ الإصدار", type: "datetime", width: 18 },
  { key: "customer", en: "Buyer", ar: "المشتري", width: 26 },
  { key: "member_code", en: "Member ID", ar: "رقم العضو", width: 14 },
  { key: "subtotal", en: "Subtotal (SAR)", ar: "المجموع قبل الضريبة", type: "money", width: 16 },
  { key: "tax_total", en: "VAT (SAR)", ar: "ضريبة القيمة المضافة", type: "money", width: 14 },
  { key: "total", en: "Total (SAR)", ar: "الإجمالي", type: "money", width: 14 },
  { key: "balance_due", en: "Balance due", ar: "المتبقي", type: "money", width: 14 },
  { key: "status", en: "Status", ar: "الحالة", width: 12 }
];

async function exportList(req, res) {
  const lang = excelExportService.exportLang(req);
  const filters = {
    branchId: req.effectiveBranchId || "",
    status: cleanString(req.query.status, 20),
    dateFrom: cleanString(req.query.dateFrom, 20),
    dateTo: cleanString(req.query.dateTo, 20),
    search: cleanString(req.query.search, 120)
  };
  if (!filters.branchId) {
    throw createHttpError(403, "No branch in scope.", "BRANCH_REQUIRED");
  }
  const data = await invoiceRepository.listInvoices({ ...filters, all: true });
  await createLog("admin", req.user.id, "invoices.export", "invoices", null, { filters, rows: data.items.length }, req.ip, req.effectiveBranchId);
  await excelExportService.sendWorkbook(
    res,
    `invoices-${excelExportService.stamp()}.xlsx`,
    [{ name: { en: "Invoices", ar: "الفواتير" }, columns: INVOICE_EXPORT_COLUMNS, rows: data.items }],
    lang
  );
}

module.exports = {
  exportList,
  create,
  detail,
  list,
  overdue,
  pdf,
  updateStatus
};
