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

module.exports = {
  revenueByMonth,
  summary
};
