const { query } = require("../config/database");
const reportRepository = require("../repositories/reportRepository");

function currentMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function previousMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function intentFor(prompt) {
  const value = String(prompt || "").toLowerCase();
  if (/joined|new members|new customers|انضم|جدد/.test(value)) return "new_customers";
  if (/didn.?t pay|unpaid|outstanding|balance|لم يدفع|متأخر/.test(value)) return "unpaid";
  if (/expiring|expire|renewal|تنتهي|تجديد/.test(value)) return "expiring_memberships";
  if (/today.*revenue|revenue today|دخل اليوم|ايراد اليوم/.test(value)) return "today_revenue";
  if (/compare|last month|previous month|قارن/.test(value)) return "compare_months";
  if (/marketing|campaign|تسويق/.test(value)) return "marketing_ideas";
  if (/sales|sell|مبيعات/.test(value)) return "sales_ideas";
  if (/retention|retain|احتفاظ/.test(value)) return "retention";
  if (/report|summary|performance|تقرير|ملخص|اداء/.test(value)) return "performance_summary";
  return "performance_summary";
}

async function ask({ prompt, branchId = null, adminId = null }) {
  const intent = intentFor(prompt);
  let response;

  if (intent === "new_customers") {
    const range = currentMonthRange();
    const rows = await query(
      `SELECT COUNT(*) AS total
       FROM users
       WHERE deleted_at IS NULL AND DATE(created_at) BETWEEN ? AND ?${branchId ? " AND branch_id = ?" : ""}`,
      branchId ? [range.from, range.to, branchId] : [range.from, range.to]
    );
    response = { intent, answer: `${rows[0]?.total || 0} customers joined this month.`, data: { range, total: Number(rows[0]?.total || 0) } };
  } else if (intent === "unpaid") {
    const rows = await query(
      `SELECT i.id, i.invoice_number, i.balance_due, u.full_name AS customer
       FROM invoices i
       JOIN users u ON u.id = i.user_id
       WHERE i.deleted_at IS NULL AND i.balance_due > 0 AND i.status IN ('pending','partial')${branchId ? " AND i.branch_id = ?" : ""}
       ORDER BY i.due_date ASC, i.issue_date ASC
       LIMIT 20`,
      branchId ? [branchId] : []
    );
    response = { intent, answer: `${rows.length} unpaid or partially paid invoices need attention.`, data: rows };
  } else if (intent === "expiring_memberships") {
    const rows = await query(
      `SELECT m.id, m.end_date, u.full_name AS customer, p.name_en AS plan
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       JOIN plans p ON p.id = m.plan_id
       WHERE m.status = 'active' AND m.end_date BETWEEN UTC_DATE() AND UTC_DATE() + INTERVAL 14 DAY${branchId ? " AND m.branch_id = ?" : ""}
       ORDER BY m.end_date ASC
       LIMIT 30`,
      branchId ? [branchId] : []
    );
    response = { intent, answer: `${rows.length} active memberships expire within 14 days.`, data: rows };
  } else if (intent === "today_revenue") {
    const rows = await query(
      `SELECT COALESCE(SUM(amount), 0) AS revenue, COUNT(*) AS transactions
       FROM payments
       WHERE status = 'completed' AND DATE(completed_at) = UTC_DATE()${branchId ? " AND branch_id = ?" : ""}`,
      branchId ? [branchId] : []
    );
    response = { intent, answer: `Today's revenue is SAR ${Number(rows[0]?.revenue || 0).toFixed(2)}.`, data: rows[0] };
  } else if (intent === "compare_months") {
    const current = await reportRepository.summary({ branchId, ...currentMonthRange() });
    const previous = await reportRepository.summary({ branchId, ...previousMonthRange() });
    const delta = current.metrics.revenue - previous.metrics.revenue;
    response = {
      intent,
      answer: `Current month revenue is SAR ${current.metrics.revenue.toFixed(2)}, ${delta >= 0 ? "up" : "down"} SAR ${Math.abs(delta).toFixed(2)} versus last month.`,
      data: { current: current.metrics, previous: previous.metrics, delta }
    };
  } else if (intent === "marketing_ideas" || intent === "sales_ideas" || intent === "retention") {
    const ideas = {
      marketing_ideas: [
        "Run a 7-day expiring-membership winback campaign.",
        "Promote the most popular plan with a limited joining bonus.",
        "Create branch-specific testimonial content for social channels."
      ],
      sales_ideas: [
        "Follow up on pending invoices before peak hours.",
        "Bundle personal assessment with long-duration memberships.",
        "Offer corporate packages to companies near the branch."
      ],
      retention: [
        "Flag members with low attendance and assign trainer follow-up.",
        "Send progress-summary messages before renewal date.",
        "Create a freeze/reactivation flow for members at risk of churn."
      ]
    }[intent];
    response = { intent, answer: ideas.join(" "), data: { ideas } };
  } else {
    const data = await reportRepository.summary({ branchId, ...currentMonthRange() });
    response = {
      intent,
      answer: `Revenue is SAR ${data.metrics.revenue.toFixed(2)}, profit is SAR ${data.metrics.profit.toFixed(2)}, and ${data.metrics.newCustomers} customers joined in the selected period.`,
      data
    };
  }

  const result = await query(
    `INSERT INTO ai_logs (branch_id, admin_user_id, prompt, intent, response, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, 'success', ?, ?)`,
    [branchId || null, adminId || null, prompt, intent, JSON.stringify(response), adminId || null, adminId || null]
  );

  if (["marketing_ideas", "sales_ideas", "retention"].includes(intent)) {
    await query(
      `INSERT INTO ai_recommendations (branch_id, title, body, category, priority, source_log_id, created_by, updated_by)
       VALUES (?, ?, ?, ?, 'medium', ?, ?, ?)`,
      [branchId || null, response.answer.slice(0, 160), response.answer, intent === "sales_ideas" ? "sales" : intent === "retention" ? "retention" : "marketing", result.insertId, adminId || null, adminId || null]
    );
  }

  return response;
}

module.exports = {
  ask
};
