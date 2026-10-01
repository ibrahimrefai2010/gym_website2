const reportRepository = require("../repositories/reportRepository");
const branchRepository = require("../repositories/branchRepository");
const excelExportService = require("../services/excelExportService");
const { canSwitchBranch } = require("../security/branchAccess");
const { createHttpError } = require("../utils/httpError");
const { createLog } = require("../utils/logger");
const { hijriYear, hijriYearBounds } = require("../utils/hijri");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Which branches a report covers -- always server-decided:
//  - default: the admin's effective branch (switcher for super_admin /
//    branches:manage, fixed home branch for everyone else).
//  - ?scope=all (consolidated): only for admins who can switch branches;
//    anyone else gets 403, never silently a wider view.
// Previously summary/revenue took ?branchId= from the client and returned
// ALL branches when it was absent -- a cross-branch financial leak.
async function resolveReportBranchIds(req) {
  if (String(req.query.scope || "") === "all") {
    if (!(await canSwitchBranch(req.user))) {
      throw createHttpError(403, "Consolidated reports need cross-branch access.", "REPORT_SCOPE_FORBIDDEN");
    }
    const { items } = await branchRepository.listBranches({ status: "active", pageSize: 100 });
    return items.map((branch) => Number(branch.id));
  }
  if (!req.effectiveBranchId) {
    throw createHttpError(403, "No branch in scope.", "BRANCH_REQUIRED");
  }
  return [Number(req.effectiveBranchId)];
}

function dateRange(req) {
  const today = new Date().toISOString().slice(0, 10);
  const from = DATE_RE.test(req.query.from || "") ? req.query.from : `${today.slice(0, 7)}-01`;
  const to = DATE_RE.test(req.query.to || "") ? req.query.to : today;
  if (from > to) {
    throw createHttpError(422, "The start date must be before the end date.", "REPORT_RANGE_INVALID");
  }
  return { from, to };
}

function wantsXlsx(req) {
  return String(req.query.format || "") === "xlsx";
}

async function logExport(req, report, meta) {
  await createLog("admin", req.user.id, `reports.export.${report}`, null, null, meta, req.ip, req.effectiveBranchId);
}

async function summary(req, res) {
  const [branchId] = await resolveReportBranchIds(req);
  const data = await reportRepository.summary({
    branchId: req.query.scope === "all" ? "" : branchId,
    dateFrom: DATE_RE.test(req.query.dateFrom || "") ? req.query.dateFrom : "",
    dateTo: DATE_RE.test(req.query.dateTo || "") ? req.query.dateTo : ""
  });
  res.json({ success: true, data });
}

async function revenue(req, res) {
  const [branchId] = await resolveReportBranchIds(req);
  const data = await reportRepository.revenueByMonth({
    branchId: req.query.scope === "all" ? "" : branchId,
    months: req.query.months || 12
  });
  res.json({ success: true, data });
}

const lang = (req) => excelExportService.exportLang(req);
const branchLabel = (branch, l) => (branch ? branch.name[l] || branch.name.en : "");

async function vat(req, res) {
  const branchIds = await resolveReportBranchIds(req);
  const data = await reportRepository.vatReport({ branchIds, ...dateRange(req) });
  if (!wantsXlsx(req)) {
    return res.json({ success: true, data });
  }
  const l = lang(req);
  const label = (b) => branchLabel(b, l);
  const rows = [
    ...data.branches.map((b) => ({ branch: label(b.branch), ...b })),
    { branch: l === "ar" ? "الإجمالي الموحد" : "Consolidated", ...data.consolidated }
  ];
  await logExport(req, "vat", { ...data.range, branches: branchIds });
  return excelExportService.sendWorkbook(
    res,
    `vat-${data.range.from}-${data.range.to}.xlsx`,
    [
      {
        name: { en: "VAT summary", ar: "ملخص الضريبة" },
        columns: [
          { key: "branch", en: "Branch", ar: "الفرع", width: 22 },
          { key: "invoiceCount", en: "Invoices", ar: "عدد الفواتير", width: 12 },
          { key: "taxableAmount", en: "Taxable amount (SAR)", ar: "المبلغ الخاضع للضريبة", type: "money", width: 20 },
          { key: "outputVat", en: "Output VAT (SAR)", ar: "ضريبة المخرجات", type: "money", width: 18 },
          { key: "grossTotal", en: "Total incl. VAT (SAR)", ar: "الإجمالي شامل الضريبة", type: "money", width: 20 }
        ],
        rows
      },
      {
        name: { en: "By method", ar: "حسب طريقة الدفع" },
        columns: [
          { key: "branch", en: "Branch", ar: "الفرع", width: 22 },
          { key: "method", en: "Method", ar: "طريقة الدفع", width: 16 },
          { key: "invoiceCount", en: "Invoices", ar: "عدد الفواتير", width: 12 },
          { key: "taxableAmount", en: "Taxable (SAR)", ar: "الخاضع للضريبة", type: "money", width: 16 },
          { key: "outputVat", en: "VAT (SAR)", ar: "الضريبة", type: "money", width: 14 }
        ],
        rows: data.byMethod.map((r) => ({ ...r, branch: label(data.branches.find((b) => b.branch?.id === r.branchId)?.branch) }))
      },
      {
        name: { en: "By month", ar: "حسب الشهر" },
        columns: [
          { key: "branch", en: "Branch", ar: "الفرع", width: 22 },
          { key: "month", en: "Month", ar: "الشهر", width: 10 },
          { key: "invoiceCount", en: "Invoices", ar: "عدد الفواتير", width: 12 },
          { key: "taxableAmount", en: "Taxable (SAR)", ar: "الخاضع للضريبة", type: "money", width: 16 },
          { key: "outputVat", en: "VAT (SAR)", ar: "الضريبة", type: "money", width: 14 }
        ],
        rows: data.byMonth.map((r) => ({ ...r, branch: label(data.branches.find((b) => b.branch?.id === r.branchId)?.branch) }))
      }
    ],
    l
  );
}

function requestedHijriYear(req) {
  const year = Number(req.query.hijriYear || req.body?.hijriYear || hijriYear());
  if (!Number.isInteger(year) || year < 1440 || year > 1500) {
    throw createHttpError(422, "Choose a valid Hijri year.", "HIJRI_YEAR_INVALID");
  }
  return year;
}

async function zakat(req, res) {
  const branchIds = await resolveReportBranchIds(req);
  const year = requestedHijriYear(req);
  const data = await reportRepository.zakatWorksheet({ branchIds, hijriYear: year, bounds: hijriYearBounds(year) });
  if (!wantsXlsx(req)) {
    return res.json({ success: true, data });
  }
  const l = lang(req);
  const flat = (b, name) => ({ branch: name, ...b.system, ...b.inputs });
  const rows = [
    ...data.branches.map((b) => flat(b, branchLabel(b.branch, l))),
    flat(data.consolidated, l === "ar" ? "الإجمالي الموحد" : "Consolidated")
  ];
  await logExport(req, "zakat", { hijriYear: year, branches: branchIds });
  return excelExportService.sendWorkbook(
    res,
    `zakat-worksheet-${year}.xlsx`,
    [
      {
        name: { en: `Zakat ${year}`, ar: `الزكاة ${year}` },
        columns: [
          { key: "branch", en: "Branch", ar: "الفرع", width: 22 },
          { key: "revenueGross", en: "Revenue incl. VAT", ar: "الإيرادات شاملة الضريبة", type: "money", width: 18 },
          { key: "revenueNet", en: "Revenue excl. VAT", ar: "الإيرادات قبل الضريبة", type: "money", width: 18 },
          { key: "vatCollected", en: "VAT collected", ar: "الضريبة المحصلة", type: "money", width: 16 },
          { key: "expenses", en: "Approved expenses", ar: "المصروفات المعتمدة", type: "money", width: 18 },
          { key: "receivablesOpen", en: "Open receivables (system)", ar: "الذمم المدينة (النظام)", type: "money", width: 20 },
          { key: "cash_on_hand", en: "Cash on hand", ar: "النقد في الصندوق", type: "money", width: 16 },
          { key: "bank_balances", en: "Bank balances", ar: "أرصدة البنوك", type: "money", width: 16 },
          { key: "receivables", en: "Receivables (accountant)", ar: "الذمم المدينة (المحاسب)", type: "money", width: 20 },
          { key: "inventory", en: "Inventory", ar: "المخزون", type: "money", width: 14 },
          { key: "prepaid_expenses", en: "Prepaid expenses", ar: "مصروفات مدفوعة مقدمًا", type: "money", width: 18 },
          { key: "current_liabilities", en: "Current liabilities", ar: "الالتزامات المتداولة", type: "money", width: 18 }
        ],
        rows
      }
    ],
    l
  );
}

// Accountant inputs are saved per branch -- always the effective branch,
// even when viewing consolidated (consolidated is a read-only sum).
async function saveZakat(req, res) {
  if (!req.effectiveBranchId) {
    throw createHttpError(403, "No branch in scope.", "BRANCH_REQUIRED");
  }
  const year = requestedHijriYear(req);
  const data = await reportRepository.saveZakatInputs(
    {
      branchId: req.effectiveBranchId,
      hijriYear: year,
      inputs: req.body?.inputs || {},
      otherInputs: req.body?.otherInputs || [],
      notes: req.body?.notes || ""
    },
    req.user.id
  );
  await createLog("admin", req.user.id, "reports.zakat.save", "zakat_worksheets", null, { hijriYear: year }, req.ip, req.effectiveBranchId);
  res.json({ success: true, data });
}

async function annual(req, res) {
  const branchIds = await resolveReportBranchIds(req);
  const year = Number(req.query.year || new Date().getUTCFullYear());
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw createHttpError(422, "Choose a valid year.", "YEAR_INVALID");
  }
  const data = await reportRepository.annualRevenue({ branchIds, year });
  if (!wantsXlsx(req)) {
    return res.json({ success: true, data });
  }
  const l = lang(req);
  await logExport(req, "revenue", { year, branches: branchIds });
  const branchColumns = data.branches.map((b) => ({ key: `b${b.branch.id}`, en: b.branch.name.en, ar: b.branch.name.ar, type: "money", width: 16 }));
  return excelExportService.sendWorkbook(
    res,
    `revenue-${year}.xlsx`,
    [
      {
        name: { en: "By month", ar: "حسب الشهر" },
        columns: [{ key: "month", en: "Month", ar: "الشهر", width: 8 }, ...branchColumns, { key: "revenue", en: "Total (SAR)", ar: "الإجمالي", type: "money", width: 16 }, { key: "payments", en: "Payments", ar: "عدد الدفعات", width: 12 }],
        rows: data.months.map((m) => ({ ...m, ...Object.fromEntries(data.branches.map((b) => [`b${b.branch.id}`, m.byBranch[b.branch.id] || 0])) }))
      },
      {
        name: { en: "By plan", ar: "حسب الباقة" },
        columns: [{ key: "plan", en: "Plan", ar: "الباقة", width: 26 }, { key: "payments", en: "Payments", ar: "عدد الدفعات", width: 12 }, { key: "revenue", en: "Revenue (SAR)", ar: "الإيراد", type: "money", width: 16 }],
        rows: data.byPlan.map((r) => ({ ...r, plan: r.name[l] || r.name.en }))
      },
      {
        name: { en: "By method", ar: "حسب طريقة الدفع" },
        columns: [{ key: "method", en: "Method", ar: "طريقة الدفع", width: 18 }, { key: "payments", en: "Payments", ar: "عدد الدفعات", width: 12 }, { key: "revenue", en: "Revenue (SAR)", ar: "الإيراد", type: "money", width: 16 }],
        rows: data.byMethod
      }
    ],
    l
  );
}

async function churn(req, res) {
  const branchIds = await resolveReportBranchIds(req);
  const data = await reportRepository.churnReport({ branchIds, ...dateRange(req) });
  if (!wantsXlsx(req)) {
    return res.json({ success: true, data });
  }
  const l = lang(req);
  await logExport(req, "churn", { ...data.range, branches: branchIds });
  return excelExportService.sendWorkbook(
    res,
    `churn-${data.range.from}-${data.range.to}.xlsx`,
    [
      {
        name: { en: "Renewal & churn", ar: "التجديد والانسحاب" },
        columns: [
          { key: "branch", en: "Branch", ar: "الفرع", width: 22 },
          { key: "renewed", en: "Renewed", ar: "جددوا", width: 12 },
          { key: "churned", en: "Churned", ar: "لم يجددوا", width: 12 },
          { key: "renewalRate", en: "Renewal rate %", ar: "نسبة التجديد %", width: 16 },
          { key: "churnRate", en: "Churn rate %", ar: "نسبة الانسحاب %", width: 16 }
        ],
        rows: [...data.branches.map((b) => ({ ...b, branch: branchLabel(b.branch, l) })), { ...data.consolidated, branch: l === "ar" ? "الإجمالي الموحد" : "Consolidated" }]
      }
    ],
    l
  );
}

module.exports = {
  annual,
  churn,
  resolveReportBranchIds,
  revenue,
  saveZakat,
  summary,
  vat,
  zakat
};
