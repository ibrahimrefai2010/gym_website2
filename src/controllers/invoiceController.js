const invoiceRepository = require("../repositories/invoiceRepository");
const { createHttpError } = require("../utils/httpError");
const { createLog } = require("../utils/logger");
const { cleanString, pagination, requireFields } = require("../utils/validator");

async function list(req, res) {
  const data = await invoiceRepository.listInvoices({
    ...pagination(req.query),
    branchId: cleanString(req.query.branchId, 20),
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
  if (!data) {
    throw createHttpError(404, "Invoice not found.", "INVOICE_NOT_FOUND");
  }
  res.json({ success: true, data });
}

async function create(req, res) {
  requireFields(req.body, ["userId"]);
  const data = await invoiceRepository.createInvoice(req.body, req.user?.id);
  await createLog("admin", req.user?.id, "invoice.create", "invoices", data.id, null, req.ip);
  res.status(201).json({ success: true, data: await invoiceRepository.getInvoice(data.id) });
}

async function updateStatus(req, res) {
  const status = cleanString(req.body.status, 20);
  const data = await invoiceRepository.updateInvoiceStatus(req.params.id, status, req.user?.id);
  await createLog("admin", req.user?.id, "invoice.status.update", "invoices", req.params.id, { status }, req.ip);
  res.json({ success: true, data });
}

module.exports = {
  create,
  detail,
  list,
  updateStatus
};
