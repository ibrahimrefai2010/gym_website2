const { hasDatabaseConfig, query } = require("../config/database");
const { createHttpError } = require("../utils/httpError");
const { positiveInteger } = require("../utils/validator");

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

function branchClause(alias, branchId, params) {
  if (!branchId) {
    return "";
  }
  params.push(branchId);
  return ` AND ${alias}.branch_id = ?`;
}

async function summary({ branchId = "", dateFrom = "", dateTo = "" } = {}) {
  ensureDatabase();
  const now = new Date();
  const from = dateFrom || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const to = dateTo || new Date().toISOString().slice(0, 10);

  const paymentParams = [`${from} 00:00:00`, `${to} 23:59:59`];
  const expenseParams = [from, to];
  const customerParams = [from, to];
  const attendanceParams = [from, to];
  const branchPayment = branchClause("p", branchId, paymentParams);
  const branchExpense = branchClause("e", branchId, expenseParams);
  const branchCustomer = branchClause("u", branchId, customerParams);
  const branchAttendance = branchClause("a", branchId, attendanceParams);

  const [revenueRows, expenseRows, customerRows, membershipRows, attendanceRows, topPlans, recentPayments, recentCustomers, recommendations] =
    await Promise.all([
      query(
        `SELECT COALESCE(SUM(p.amount), 0) AS revenue, COUNT(*) AS transactions
         FROM payments p
         WHERE p.status = 'completed'
           AND p.completed_at BETWEEN ? AND ?${branchPayment}`,
        paymentParams
      ),
      query(
        `SELECT COALESCE(SUM(e.amount), 0) AS expenses, COUNT(*) AS count
         FROM expenses e
         WHERE e.deleted_at IS NULL
           AND e.expense_date BETWEEN ? AND ?${branchExpense}`,
        expenseParams
      ),
      query(
        `SELECT COUNT(*) AS new_customers
         FROM users u
         WHERE u.deleted_at IS NULL
           AND DATE(u.created_at) BETWEEN ? AND ?${branchCustomer}`,
        customerParams
      ),
      query(
        `SELECT
          SUM(m.status = 'active') AS active_memberships,
          SUM(m.status = 'expired') AS expired_memberships,
          SUM(m.status = 'pending') AS pending_memberships
         FROM memberships m
         WHERE 1 = 1${branchId ? " AND m.branch_id = ?" : ""}`,
        branchId ? [branchId] : []
      ),
      query(
        `SELECT COUNT(*) AS attendance
         FROM attendance_logs a
         WHERE a.deleted_at IS NULL
           AND DATE(a.check_in_at) BETWEEN ? AND ?${branchAttendance}`,
        attendanceParams
      ),
      query(
        `SELECT p.name_en AS plan, COUNT(*) AS total
         FROM memberships m
         JOIN plans p ON p.id = m.plan_id
         WHERE m.created_at >= UTC_TIMESTAMP() - INTERVAL 90 DAY${branchId ? " AND m.branch_id = ?" : ""}
         GROUP BY p.id
         ORDER BY total DESC
         LIMIT 5`,
        branchId ? [branchId] : []
      ),
      query(
        `SELECT p.id, p.amount, p.currency, p.status, p.completed_at, u.full_name AS customer
         FROM payments p
         JOIN users u ON u.id = p.user_id
         WHERE 1 = 1${branchId ? " AND p.branch_id = ?" : ""}
         ORDER BY p.created_at DESC
         LIMIT 8`,
        branchId ? [branchId] : []
      ),
      query(
        `SELECT u.id, u.full_name, u.email, u.phone, u.created_at
         FROM users u
         WHERE u.deleted_at IS NULL${branchId ? " AND u.branch_id = ?" : ""}
         ORDER BY u.created_at DESC
         LIMIT 8`,
        branchId ? [branchId] : []
      ),
      query(
        `SELECT id, title, body, category, priority, status, created_at
         FROM ai_recommendations
         WHERE deleted_at IS NULL AND status = 'open'${branchId ? " AND branch_id = ?" : ""}
         ORDER BY FIELD(priority, 'high', 'medium', 'low'), created_at DESC
         LIMIT 6`,
        branchId ? [branchId] : []
      )
    ]);

  const revenue = Number(revenueRows[0]?.revenue || 0);
  const expenses = Number(expenseRows[0]?.expenses || 0);
  return {
    range: { from, to },
    metrics: {
      revenue,
      expenses,
      profit: Number((revenue - expenses).toFixed(2)),
      transactions: Number(revenueRows[0]?.transactions || 0),
      newCustomers: Number(customerRows[0]?.new_customers || 0),
      activeMemberships: Number(membershipRows[0]?.active_memberships || 0),
      expiredMemberships: Number(membershipRows[0]?.expired_memberships || 0),
      pendingMemberships: Number(membershipRows[0]?.pending_memberships || 0),
      attendance: Number(attendanceRows[0]?.attendance || 0)
    },
    topPlans,
    recentPayments,
    recentCustomers,
    aiRecommendations: recommendations
  };
}

async function revenueByMonth({ branchId = "", months = 12 } = {}) {
  ensureDatabase();
  const safeMonths = positiveInteger(months, 12, 60);
  return query(
    `SELECT DATE_FORMAT(p.completed_at, '%Y-%m') AS month, COALESCE(SUM(p.amount), 0) AS revenue
     FROM payments p
     WHERE p.status = 'completed'
       AND p.completed_at >= UTC_DATE() - INTERVAL ? MONTH${branchId ? " AND p.branch_id = ?" : ""}
     GROUP BY DATE_FORMAT(p.completed_at, '%Y-%m')
     ORDER BY month ASC`,
    branchId ? [safeMonths, branchId] : [safeMonths]
  );
}

// ---------------------------------------------------------------------------
// Finance reports (Part 2 §2.0.6): VAT, Zakat worksheet, annual revenue,
// churn/renewal. Every function takes an explicit, server-resolved list of
// branch ids (see branchAccess.resolveReportBranchIds) and returns one row
// per branch plus a consolidated total, because the two branches are
// separate VAT registrations but the accountant also needs the combined view.
// ---------------------------------------------------------------------------

const round2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

function inList(ids) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => !Number.isInteger(Number(id)))) {
    throw createHttpError(422, "No branch in scope for this report.", "REPORT_BRANCH_REQUIRED");
  }
  return { sql: ids.map(() => "?").join(","), params: ids.map(Number) };
}

async function branchNames(ids) {
  const { sql, params } = inList(ids);
  const rows = await query(`SELECT id, code, name_en, name_ar FROM branches WHERE id IN (${sql})`, params);
  return new Map(rows.map((row) => [Number(row.id), { id: Number(row.id), code: row.code, name: { en: row.name_en, ar: row.name_ar } }]));
}

function sumRows(rows, keys) {
  return keys.reduce((acc, key) => ({ ...acc, [key]: round2(rows.reduce((sum, row) => sum + Number(row[key] || 0), 0)) }), {});
}

// Output VAT for a date range: issued tax invoices (cancelled/draft
// excluded), by branch, by month and by payment method.
async function vatReport({ branchIds, from, to }) {
  ensureDatabase();
  const { sql, params } = inList(branchIds);
  const names = await branchNames(branchIds);
  const base = `FROM invoices i
    WHERE i.deleted_at IS NULL AND i.status NOT IN ('cancelled','draft')
      AND i.branch_id IN (${sql}) AND i.issue_date BETWEEN ? AND ?`;
  const args = [...params, from, to];
  const [byBranch, byMonth, byMethod] = await Promise.all([
    query(
      `SELECT i.branch_id, COUNT(*) AS invoice_count,
         COALESCE(SUM(i.subtotal - i.discount_total), 0) AS taxable_amount,
         COALESCE(SUM(i.tax_total), 0) AS output_vat,
         COALESCE(SUM(i.total), 0) AS gross_total
       ${base} GROUP BY i.branch_id`,
      args
    ),
    query(
      `SELECT i.branch_id, DATE_FORMAT(i.issue_date, '%Y-%m') AS month, COUNT(*) AS invoice_count,
         COALESCE(SUM(i.subtotal - i.discount_total), 0) AS taxable_amount, COALESCE(SUM(i.tax_total), 0) AS output_vat
       ${base} GROUP BY i.branch_id, month ORDER BY month`,
      args
    ),
    query(
      `SELECT i.branch_id, COALESCE(p.payment_method, 'unpaid') AS method, COUNT(*) AS invoice_count,
         COALESCE(SUM(i.subtotal - i.discount_total), 0) AS taxable_amount, COALESCE(SUM(i.tax_total), 0) AS output_vat
       ${base.replace("FROM invoices i", "FROM invoices i LEFT JOIN payments p ON p.invoice_id = i.id AND p.status = 'completed'")}
       GROUP BY i.branch_id, method ORDER BY method`,
      args
    )
  ]);
  const branches = branchIds.map((id) => {
    const row = byBranch.find((r) => Number(r.branch_id) === Number(id)) || {};
    return {
      branch: names.get(Number(id)),
      invoiceCount: Number(row.invoice_count || 0),
      taxableAmount: round2(row.taxable_amount),
      outputVat: round2(row.output_vat),
      grossTotal: round2(row.gross_total)
    };
  });
  const consolidated = {
    invoiceCount: branches.reduce((sum, b) => sum + b.invoiceCount, 0),
    ...sumRows(branches, ["taxableAmount", "outputVat", "grossTotal"])
  };
  return {
    range: { from, to },
    branches,
    consolidated,
    byMonth: byMonth.map((r) => ({ branchId: Number(r.branch_id), month: r.month, invoiceCount: Number(r.invoice_count), taxableAmount: round2(r.taxable_amount), outputVat: round2(r.output_vat) })),
    byMethod: byMethod.map((r) => ({ branchId: Number(r.branch_id), method: r.method, invoiceCount: Number(r.invoice_count), taxableAmount: round2(r.taxable_amount), outputVat: round2(r.output_vat) }))
  };
}

const ZAKAT_INPUT_FIELDS = ["cash_on_hand", "bank_balances", "receivables", "inventory", "prepaid_expenses", "current_liabilities"];

// Zakat helper worksheet for one Hijri year: system-known figures + the
// accountant's saved manual inputs. Not a Zakat calculation.
async function zakatWorksheet({ branchIds, hijriYear, bounds }) {
  ensureDatabase();
  const { sql, params } = inList(branchIds);
  const names = await branchNames(branchIds);
  const [revenueRows, expenseRows, receivableRows, inputRows] = await Promise.all([
    query(
      `SELECT branch_id, COUNT(*) AS invoice_count, COALESCE(SUM(total), 0) AS revenue_gross,
         COALESCE(SUM(subtotal - discount_total), 0) AS revenue_net, COALESCE(SUM(tax_total), 0) AS vat_collected
       FROM invoices
       WHERE deleted_at IS NULL AND status NOT IN ('cancelled','draft') AND branch_id IN (${sql})
         AND (hijri_year = ? OR (hijri_year IS NULL AND issue_date BETWEEN ? AND ?))
       GROUP BY branch_id`,
      [...params, hijriYear, bounds.start, bounds.end]
    ),
    query(
      `SELECT branch_id, COALESCE(SUM(amount), 0) AS expenses
       FROM expenses
       WHERE deleted_at IS NULL AND status IN ('approved','paid') AND branch_id IN (${sql})
         AND expense_date BETWEEN ? AND ?
       GROUP BY branch_id`,
      [...params, bounds.start, bounds.end]
    ),
    query(
      `SELECT branch_id, COALESCE(SUM(balance_due), 0) AS receivables_open
       FROM invoices
       WHERE deleted_at IS NULL AND status IN ('pending','partial') AND balance_due > 0 AND branch_id IN (${sql})
         AND issue_date <= ?
       GROUP BY branch_id`,
      [...params, bounds.end]
    ),
    query(`SELECT * FROM zakat_worksheets WHERE hijri_year = ? AND branch_id IN (${sql})`, [hijriYear, ...params])
  ]);
  const find = (rows, id) => rows.find((r) => Number(r.branch_id) === Number(id)) || {};
  const branches = branchIds.map((id) => {
    const revenue = find(revenueRows, id);
    const input = find(inputRows, id);
    return {
      branch: names.get(Number(id)),
      system: {
        invoiceCount: Number(revenue.invoice_count || 0),
        revenueGross: round2(revenue.revenue_gross),
        revenueNet: round2(revenue.revenue_net),
        vatCollected: round2(revenue.vat_collected),
        expenses: round2(find(expenseRows, id).expenses),
        receivablesOpen: round2(find(receivableRows, id).receivables_open)
      },
      inputs: Object.fromEntries(ZAKAT_INPUT_FIELDS.map((field) => [field, input[field] == null ? null : Number(input[field])])),
      otherInputs: input.other_inputs ? (typeof input.other_inputs === "string" ? JSON.parse(input.other_inputs) : input.other_inputs) : [],
      notes: input.notes || "",
      updatedAt: input.updated_at || null
    };
  });
  const consolidated = {
    system: sumRows(branches.map((b) => b.system), ["invoiceCount", "revenueGross", "revenueNet", "vatCollected", "expenses", "receivablesOpen"]),
    inputs: sumRows(branches.map((b) => b.inputs), ZAKAT_INPUT_FIELDS)
  };
  return { hijriYear, bounds, branches, consolidated };
}

function decimalOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 1e12) {
    throw createHttpError(422, "Worksheet amounts must be numbers.", "ZAKAT_INPUT_INVALID");
  }
  return round2(number);
}

async function saveZakatInputs({ branchId, hijriYear, inputs = {}, otherInputs = [], notes = "" }, adminId) {
  ensureDatabase();
  const values = ZAKAT_INPUT_FIELDS.map((field) => decimalOrNull(inputs[field]));
  const others = (Array.isArray(otherInputs) ? otherInputs : [])
    .slice(0, 20)
    .map((row) => ({ label: String(row?.label || "").slice(0, 120), amount: decimalOrNull(row?.amount) }))
    .filter((row) => row.label);
  await query(
    `INSERT INTO zakat_worksheets (branch_id, hijri_year, ${ZAKAT_INPUT_FIELDS.join(", ")}, other_inputs, notes, updated_by)
     VALUES (?, ?, ${ZAKAT_INPUT_FIELDS.map(() => "?").join(", ")}, ?, ?, ?)
     ON DUPLICATE KEY UPDATE ${ZAKAT_INPUT_FIELDS.map((field) => `${field} = VALUES(${field})`).join(", ")},
       other_inputs = VALUES(other_inputs), notes = VALUES(notes), updated_by = VALUES(updated_by)`,
    [branchId, hijriYear, ...values, JSON.stringify(others), String(notes || "").slice(0, 5000), adminId]
  );
  return { branchId, hijriYear, saved: true };
}

// Completed payments for a Gregorian year, by month / plan / method / branch.
async function annualRevenue({ branchIds, year }) {
  ensureDatabase();
  const { sql, params } = inList(branchIds);
  const names = await branchNames(branchIds);
  const from = `${year}-01-01 00:00:00`;
  const to = `${year}-12-31 23:59:59`;
  const base = `FROM payments p WHERE p.status = 'completed' AND p.branch_id IN (${sql}) AND p.completed_at BETWEEN ? AND ?`;
  const args = [...params, from, to];
  const [byMonth, byPlan, byMethod, byBranch] = await Promise.all([
    query(`SELECT p.branch_id, MONTH(p.completed_at) AS month, COUNT(*) AS payments, COALESCE(SUM(p.amount), 0) AS revenue ${base} GROUP BY p.branch_id, month ORDER BY month`, args),
    query(
      `SELECT p.plan_id, pl.name_en, pl.name_ar, COUNT(*) AS payments, COALESCE(SUM(p.amount), 0) AS revenue
       ${base.replace("FROM payments p", "FROM payments p LEFT JOIN plans pl ON pl.id = p.plan_id")}
       GROUP BY p.plan_id, pl.name_en, pl.name_ar ORDER BY revenue DESC`,
      args
    ),
    query(`SELECT p.payment_method AS method, COUNT(*) AS payments, COALESCE(SUM(p.amount), 0) AS revenue ${base} GROUP BY method ORDER BY revenue DESC`, args),
    query(`SELECT p.branch_id, COUNT(*) AS payments, COALESCE(SUM(p.amount), 0) AS revenue ${base} GROUP BY p.branch_id`, args)
  ]);
  const months = Array.from({ length: 12 }, (_, index) => {
    const rows = byMonth.filter((r) => Number(r.month) === index + 1);
    return {
      month: index + 1,
      revenue: round2(rows.reduce((sum, r) => sum + Number(r.revenue), 0)),
      payments: rows.reduce((sum, r) => sum + Number(r.payments), 0),
      byBranch: Object.fromEntries(rows.map((r) => [Number(r.branch_id), round2(r.revenue)]))
    };
  });
  const branches = branchIds.map((id) => {
    const row = byBranch.find((r) => Number(r.branch_id) === Number(id)) || {};
    return { branch: names.get(Number(id)), payments: Number(row.payments || 0), revenue: round2(row.revenue) };
  });
  return {
    year,
    months,
    branches,
    consolidated: { payments: branches.reduce((s, b) => s + b.payments, 0), revenue: round2(branches.reduce((s, b) => s + b.revenue, 0)) },
    byPlan: byPlan.map((r) => ({ planId: r.plan_id, name: { en: r.name_en || "Other", ar: r.name_ar || "أخرى" }, payments: Number(r.payments), revenue: round2(r.revenue) })),
    byMethod: byMethod.map((r) => ({ method: r.method, payments: Number(r.payments), revenue: round2(r.revenue) }))
  };
}

// Churn / renewal for a period. Renewals EXTEND the existing membership's
// end date (online + reception), so "memberships that ended in the period"
// would silently drop renewed members. Instead:
//   renewed = distinct members with a completed renewal payment in the
//             period, or a new membership started in the period within 30
//             days of a previous one ending (lapsed-then-returned).
//   churned = distinct members whose membership ended in the period (and is
//             already past) with no active membership today.
//   renewal rate = renewed / (renewed + churned).
async function churnReport({ branchIds, from, to }) {
  ensureDatabase();
  const { sql, params } = inList(branchIds);
  const names = await branchNames(branchIds);
  const [renewedRows, churnedRows] = await Promise.all([
    query(
      `SELECT branch_id, COUNT(DISTINCT user_id) AS renewed FROM (
         SELECT p.branch_id, p.user_id FROM payments p
         WHERE p.status = 'completed' AND p.purpose = 'renewal' AND p.branch_id IN (${sql})
           AND p.completed_at BETWEEN ? AND ?
         UNION
         SELECT nm.branch_id, nm.user_id FROM memberships nm
         WHERE nm.branch_id IN (${sql}) AND nm.status IN ('active','expired') AND nm.start_date BETWEEN ? AND ?
           AND EXISTS (SELECT 1 FROM memberships pm WHERE pm.user_id = nm.user_id AND pm.id <> nm.id
                         AND pm.end_date BETWEEN nm.start_date - INTERVAL 30 DAY AND nm.start_date)
       ) r GROUP BY branch_id`,
      [...params, `${from} 00:00:00`, `${to} 23:59:59`, ...params, from, to]
    ),
    query(
      `SELECT m.branch_id, COUNT(DISTINCT m.user_id) AS churned
       FROM memberships m
       WHERE m.branch_id IN (${sql}) AND m.status IN ('active','expired')
         AND m.end_date BETWEEN ? AND ? AND m.end_date < UTC_DATE()
         AND NOT EXISTS (SELECT 1 FROM memberships am WHERE am.user_id = m.user_id AND am.status = 'active' AND am.end_date >= UTC_DATE())
       GROUP BY m.branch_id`,
      [...params, from, to]
    )
  ]);
  const rate = (part, whole) => (whole ? round2((part / whole) * 100) : null);
  const branches = branchIds.map((id) => {
    const renewed = Number((renewedRows.find((r) => Number(r.branch_id) === Number(id)) || {}).renewed || 0);
    const churned = Number((churnedRows.find((r) => Number(r.branch_id) === Number(id)) || {}).churned || 0);
    return { branch: names.get(Number(id)), renewed, churned, renewalRate: rate(renewed, renewed + churned), churnRate: rate(churned, renewed + churned) };
  });
  const renewed = branches.reduce((sum, b) => sum + b.renewed, 0);
  const churned = branches.reduce((sum, b) => sum + b.churned, 0);
  return {
    range: { from, to },
    branches,
    consolidated: { renewed, churned, renewalRate: rate(renewed, renewed + churned), churnRate: rate(churned, renewed + churned) }
  };
}

module.exports = {
  ZAKAT_INPUT_FIELDS,
  annualRevenue,
  churnReport,
  revenueByMonth,
  saveZakatInputs,
  vatReport,
  zakatWorksheet,
  summary
};
