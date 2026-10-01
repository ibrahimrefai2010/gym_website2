const paymentService = require("../services/paymentService");
const paymentRepository = require("../repositories/paymentRepository");
const userRepository = require("../repositories/userRepository");
const { assertBranchOwnership } = require("../security/branchAccess");
const { createHttpError } = require("../utils/httpError");
const { cleanString, pagination } = require("../utils/validator");
const { createLog } = require("../utils/logger");
const excelExportService = require("../services/excelExportService");

function requestOrigin(req) {
  return `${req.protocol}://${req.get("host")}`;
}

// Member starts (or resumes) an online checkout for one of their own
// branch's plans. Plan/branch validation and everything else happens in
// paymentService.startMoyasarCheckout -- the plan id is the only client input.
async function createCheckout(req, res) {
  if (req.user?.type !== "user") {
    throw createHttpError(403, "Only members can start a checkout.", "CHECKOUT_MEMBERS_ONLY");
  }
  if (!req.body?.planId) {
    throw createHttpError(422, "Choose a plan first.", "PLAN_REQUIRED");
  }
  if (req.body.provider === "stripe") {
    throw createHttpError(410, "This payment method is no longer available.", "PROVIDER_RETIRED");
  }
  const data = await paymentService.startMoyasarCheckout({
    userId: req.user.id,
    planId: req.body.planId,
    origin: requestOrigin(req)
  });
  res.status(201).json({ success: true, data });
}

// Kept for older clients; same as /checkout.
const createIntent = createCheckout;

async function webhook(req, res) {
  const provider = req.params.provider || "moyasar";
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  if (provider === "moyasar") {
    const data = await paymentService.handleMoyasarWebhook(rawBody);
    return res.json({ success: true, data });
  }
  const data = await paymentService.verifyWebhook(provider, {
    rawBody,
    signature: req.get("stripe-signature") || ""
  });
  return res.json({ success: true, data });
}

async function status(req, res) {
  const data = await paymentService.memberPaymentStatus(req.user.id, req.params.id);
  res.json({ success: true, data });
}

async function complete(req, res) {
  const owner = await paymentRepository.getPaymentOwnerBranch(req.params.id);
  await assertBranchOwnership(owner, req, createHttpError(404, "Payment not found.", "PAYMENT_NOT_FOUND"));

  const data = await paymentService.completePayment(req.user.id, req.params.id, {
    ipAddress: req.ip
  });
  res.json({ success: true, data });
}

async function history(req, res) {
  const dashboard = await userRepository.getDashboard(req.user.id);
  res.json({ success: true, data: dashboard.payments || [] });
}

const PAYMENT_STATUSES = ["pending", "completed", "failed", "refunded", "cancelled"];
const PAYMENT_PROVIDERS = ["manual", "moyasar", "stripe"];
const PAYMENT_METHODS = ["cash", "card", "bank_transfer", "manual", "moyasar", "stripe"];

function paymentListFilters(req) {
  const pick = (value, allowed) => (allowed.includes(value) ? value : "");
  return {
    branchId: req.effectiveBranchId || "",
    status: pick(cleanString(req.query.status, 20), PAYMENT_STATUSES),
    provider: pick(cleanString(req.query.provider, 20), PAYMENT_PROVIDERS),
    method: pick(cleanString(req.query.method, 20), PAYMENT_METHODS),
    dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(req.query.dateFrom || "") ? req.query.dateFrom : "",
    dateTo: /^\d{4}-\d{2}-\d{2}$/.test(req.query.dateTo || "") ? req.query.dateTo : "",
    search: cleanString(req.query.search, 120)
  };
}

// Admin payments list -- branch is always the server-derived effective
// branch (req.effectiveBranchId), never a query param.
async function adminList(req, res) {
  const { page, pageSize } = pagination(req.query);
  const data = await paymentRepository.listPayments(paymentListFilters(req), { page, pageSize });
  res.json({ success: true, data });
}

const PAYMENT_EXPORT_COLUMNS = [
  { key: "id", en: "Payment #", ar: "رقم الدفعة", width: 10 },
  { key: "created_at", en: "Date", ar: "التاريخ", type: "datetime", width: 18 },
  { key: "invoice_number", en: "Invoice #", ar: "رقم الفاتورة", width: 20 },
  { key: "member", en: "Member", ar: "العضو", width: 26 },
  { key: "member_code", en: "Member ID", ar: "رقم العضو", width: 14 },
  { key: "plan", en: "Item", ar: "البند", width: 22 },
  { key: "payment_method", en: "Method", ar: "طريقة الدفع", width: 14 },
  { key: "amount", en: "Total (SAR)", ar: "الإجمالي (ريال)", type: "money", width: 14 },
  { key: "tax_total", en: "VAT (SAR)", ar: "الضريبة (ريال)", type: "money", width: 12 },
  { key: "status", en: "Status", ar: "الحالة", width: 12 },
  { key: "failure_reason", en: "Failure reason", ar: "سبب الفشل", width: 24 },
  { key: "recorded_by", en: "Recorded by", ar: "سجّلها", width: 20 }
];

async function adminExport(req, res) {
  const lang = excelExportService.exportLang(req);
  const filters = paymentListFilters(req);
  const data = await paymentRepository.listPayments(filters, { all: true });
  const rows = data.items.map((row) => ({ ...row, plan: lang === "ar" ? row.plan_ar || row.plan_en : row.plan_en || row.plan_ar }));
  await createLog("admin", req.user.id, "payments.export", "payments", null, { filters, rows: rows.length }, req.ip, req.effectiveBranchId);
  await excelExportService.sendWorkbook(
    res,
    `payments-${excelExportService.stamp()}.xlsx`,
    [{ name: { en: "Payments", ar: "المدفوعات" }, columns: PAYMENT_EXPORT_COLUMNS, rows }],
    lang
  );
}

async function recordManual(req, res) {
  const data = await paymentService.recordManualPayment(req.user.id, req.effectiveBranchId, {
    userId: req.body?.userId,
    planId: req.body?.planId,
    method: req.body?.method,
    reference: req.body?.reference,
    idempotencyKey: req.body?.idempotencyKey
  });
  if (!data.duplicate) {
    await createLog("admin", req.user.id, "payment.record_manual", "payments", data.id, { method: req.body?.method, invoiceId: data.invoiceId }, req.ip, req.effectiveBranchId);
  }
  res.status(data.duplicate ? 200 : 201).json({ success: true, data });
}

module.exports = {
  adminExport,
  adminList,
  complete,
  recordManual,
  createCheckout,
  createIntent,
  history,
  status,
  webhook
};
