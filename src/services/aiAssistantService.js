// In-dashboard AI assistant (Part 2 §2.3).
//
// How it works:
//  - Claude answers staff questions by calling a fixed set of READ-ONLY
//    tools defined here. Each tool runs this app's own parameterized
//    queries, bound (by closure) to the branch list the server resolved for
//    this admin -- the model never chooses a branch, never sees SQL, and
//    never receives raw tables, only compact aggregates/short lists.
//  - There are no write tools. Anything that would change data (messaging
//    a member, extending a membership, refunds) comes back as a DRAFT for a
//    human to act on through the normal UI.
//  - Tools are filtered by the admin's own permissions (finance tools need
//    reports:read, VAT needs tax_reports:read).
//  - Member contact details (phone/email) are never sent to the model.
//  - Every question + answer is written to ai_logs and the audit log.
//  - AI_ASSISTANT_ENABLED=false removes the feature (routes 404, tab hidden).
//    With the flag on but no ANTHROPIC_API_KEY, a small rule-based fallback
//    answers the common questions so the panel still works offline.

const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");
const { env } = require("../config/env");
const { query } = require("../config/database");
const reportRepository = require("../repositories/reportRepository");
const customerRepository = require("../repositories/customerRepository");
const settingsRepository = require("../repositories/settingsRepository");
const rbacRepository = require("../repositories/rbacRepository");
const { createLog, appLogger } = require("../utils/logger");
const { createHttpError } = require("../utils/httpError");

const MAX_TOOL_ROUNDS = 6;
const GUIDE_PATH = path.join(__dirname, "..", "..", "docs", "admin-guide.md");

let client = null;
function anthropic() {
  if (!client) {
    const Ctor = Anthropic.default || Anthropic;
    client = new Ctor({ apiKey: env.anthropicApiKey, maxRetries: 2, timeout: 60_000 });
  }
  return client;
}

const isoDate = (date) => date.toISOString().slice(0, 10);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function range(input, fallbackDays = 30) {
  const to = DATE_RE.test(input?.to || "") ? input.to : isoDate(new Date());
  const from = DATE_RE.test(input?.from || "") ? input.from : isoDate(new Date(Date.now() - fallbackDays * 86400000));
  return from <= to ? { from, to } : { from: to, to: from };
}
const clampInt = (value, min, max, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : fallback;
};
const inList = (ids) => ids.map(() => "?").join(",");

// ---------------------------------------------------------------------------
// Read-only tools. `scope` = { branchIds, branchNames } -- server-resolved.
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "get_dashboard_kpis",
    permission: null,
    description:
      "Current headline numbers for the branch(es) in scope: active members, memberships expiring in 7 days, at-risk (inactive) members, today's check-ins, completed revenue in the last 30 days, pending payments, open tasks.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    async run(_input, scope) {
      const ids = scope.branchIds;
      const [row] = await query(
        `SELECT
          (SELECT COUNT(*) FROM memberships WHERE status = 'active' AND end_date >= UTC_DATE() AND branch_id IN (${inList(ids)})) AS active_members,
          (SELECT COUNT(*) FROM memberships WHERE status = 'active' AND end_date BETWEEN UTC_DATE() AND UTC_DATE() + INTERVAL 7 DAY AND branch_id IN (${inList(ids)})) AS expiring_7d,
          (SELECT COUNT(*) FROM attendance_logs WHERE deleted_at IS NULL AND DATE(CONVERT_TZ(check_in_at, '+00:00', '+03:00')) = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+03:00')) AND branch_id IN (${inList(ids)})) AS checkins_today,
          (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'completed' AND completed_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY AND branch_id IN (${inList(ids)})) AS revenue_30d,
          (SELECT COUNT(*) FROM payments WHERE status = 'pending' AND branch_id IN (${inList(ids)})) AS pending_payments,
          (SELECT COUNT(*) FROM tasks WHERE status IN ('open','in_progress') AND branch_id IN (${inList(ids)})) AS open_tasks`,
        [...ids, ...ids, ...ids, ...ids, ...ids, ...ids]
      );
      let atRisk = 0;
      for (const id of ids) {
        const days = Number(await settingsRepository.getSetting("member_inactivity_days", 14, id)) || 14;
        atRisk += (await customerRepository.listAtRiskMembers(id, days, 5000)).length;
      }
      return { ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)])), at_risk_members: atRisk, currency: "SAR" };
    }
  },
  {
    name: "get_revenue",
    permission: "reports:read",
    description: "Completed payment revenue for a date range (YYYY-MM-DD, default last 30 days): total, count, by payment method and by plan. Amounts are SAR including VAT.",
    input_schema: {
      type: "object",
      properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } },
      additionalProperties: false
    },
    async run(input, scope) {
      const { from, to } = range(input);
      const ids = scope.branchIds;
      const base = `FROM payments p LEFT JOIN plans pl ON pl.id = p.plan_id
        WHERE p.status = 'completed' AND p.branch_id IN (${inList(ids)}) AND p.completed_at BETWEEN ? AND ?`;
      const args = [...ids, `${from} 00:00:00`, `${to} 23:59:59`];
      const [totals] = await query(`SELECT COUNT(*) AS payments, COALESCE(SUM(p.amount), 0) AS revenue ${base}`, args);
      const byMethod = await query(`SELECT p.payment_method AS method, COUNT(*) AS payments, COALESCE(SUM(p.amount), 0) AS revenue ${base} GROUP BY method`, args);
      const byPlan = await query(`SELECT pl.name_en AS plan, COUNT(*) AS payments, COALESCE(SUM(p.amount), 0) AS revenue ${base} GROUP BY pl.name_en ORDER BY revenue DESC LIMIT 10`, args);
      return { from, to, revenue: Number(totals.revenue), payments: Number(totals.payments), byMethod, byPlan, currency: "SAR" };
    }
  },
  {
    name: "list_expiring_memberships",
    permission: null,
    description: "Members whose active membership ends within N days (default 7, max 60). Returns name, member code, plan and end date (no contact details).",
    input_schema: { type: "object", properties: { within_days: { type: "integer" } }, additionalProperties: false },
    async run(input, scope) {
      const days = clampInt(input?.within_days, 1, 60, 7);
      const rows = await query(
        `SELECT u.full_name AS name, u.member_code, p.name_en AS plan, DATE_FORMAT(m.end_date, '%Y-%m-%d') AS end_date
         FROM memberships m JOIN users u ON u.id = m.user_id JOIN plans p ON p.id = m.plan_id
         WHERE m.status = 'active' AND m.end_date BETWEEN UTC_DATE() AND UTC_DATE() + INTERVAL ? DAY
           AND m.branch_id IN (${inList(scope.branchIds)}) AND u.deleted_at IS NULL
         ORDER BY m.end_date ASC LIMIT 50`,
        [days, ...scope.branchIds]
      );
      return { within_days: days, count: rows.length, members: rows };
    }
  },
  {
    name: "list_at_risk_members",
    permission: null,
    description: "Members with an active membership but no check-in for the branch's inactivity window (or N days if given). Returns name, member code and last visit.",
    input_schema: { type: "object", properties: { inactivity_days: { type: "integer" } }, additionalProperties: false },
    async run(input, scope) {
      const out = [];
      for (const id of scope.branchIds) {
        const days = clampInt(input?.inactivity_days, 1, 365, Number(await settingsRepository.getSetting("member_inactivity_days", 14, id)) || 14);
        const rows = await customerRepository.listAtRiskMembers(id, days, 50);
        out.push(...rows.map((r) => ({ name: r.fullName, member_code: r.memberCode, last_visit: r.lastVisit ? isoDate(new Date(r.lastVisit)) : null, branch: scope.branchNames[id] })));
      }
      return { count: out.length, members: out.slice(0, 50) };
    }
  },
  {
    name: "list_unpaid_invoices",
    permission: "reports:read",
    description: "Invoices with an outstanding balance: invoice number, buyer name, balance due, issue date.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    async run(_input, scope) {
      const rows = await query(
        `SELECT i.invoice_number, u.full_name AS buyer, i.balance_due, DATE_FORMAT(i.issue_date, '%Y-%m-%d') AS issue_date
         FROM invoices i JOIN users u ON u.id = i.user_id
         WHERE i.deleted_at IS NULL AND i.balance_due > 0 AND i.status IN ('pending','partial') AND i.branch_id IN (${inList(scope.branchIds)})
         ORDER BY i.issue_date ASC LIMIT 30`,
        scope.branchIds
      );
      return { count: rows.length, invoices: rows, currency: "SAR" };
    }
  },
  {
    name: "get_attendance_stats",
    permission: null,
    description: "Check-in totals over the last N days (default 30, max 180): total visits, unique members, busiest weekday and hour (Riyadh time).",
    input_schema: { type: "object", properties: { days: { type: "integer" } }, additionalProperties: false },
    async run(input, scope) {
      const days = clampInt(input?.days, 1, 180, 30);
      const ids = scope.branchIds;
      const base = `FROM attendance_logs a WHERE a.deleted_at IS NULL AND a.branch_id IN (${inList(ids)}) AND a.check_in_at >= UTC_TIMESTAMP() - INTERVAL ? DAY`;
      const [totals] = await query(`SELECT COUNT(*) AS visits, COUNT(DISTINCT a.user_id) AS unique_members ${base}`, [...ids, days]);
      const [peakDay] = await query(`SELECT DAYNAME(CONVERT_TZ(a.check_in_at, '+00:00', '+03:00')) AS day, COUNT(*) AS visits ${base} GROUP BY day ORDER BY visits DESC LIMIT 1`, [...ids, days]);
      const [peakHour] = await query(`SELECT HOUR(CONVERT_TZ(a.check_in_at, '+00:00', '+03:00')) AS hour, COUNT(*) AS visits ${base} GROUP BY hour ORDER BY visits DESC LIMIT 1`, [...ids, days]);
      return { days, visits: Number(totals.visits), unique_members: Number(totals.unique_members), busiest_day: peakDay || null, busiest_hour: peakHour || null };
    }
  },
  {
    name: "get_renewal_churn",
    permission: "reports:read",
    description: "Renewal vs churn for a date range (default last 30 days): members who renewed, members whose membership ended without renewing, and the rates.",
    input_schema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      additionalProperties: false
    },
    async run(input, scope) {
      const data = await reportRepository.churnReport({ branchIds: scope.branchIds, ...range(input) });
      return { range: data.range, consolidated: data.consolidated, byBranch: data.branches.map((b) => ({ branch: b.branch?.name?.en, renewed: b.renewed, churned: b.churned, renewal_rate: b.renewalRate })) };
    }
  },
  {
    name: "get_vat_summary",
    permission: "tax_reports:read",
    description: "Output VAT for a date range from issued tax invoices: taxable amount, VAT, invoice count, per branch and consolidated. Internal use only.",
    input_schema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      additionalProperties: false
    },
    async run(input, scope) {
      const data = await reportRepository.vatReport({ branchIds: scope.branchIds, ...range(input) });
      return { range: data.range, consolidated: data.consolidated, byBranch: data.branches.map((b) => ({ branch: b.branch?.name?.en, invoices: b.invoiceCount, taxable: b.taxableAmount, vat: b.outputVat })) };
    }
  },
  {
    name: "search_admin_guide",
    permission: null,
    description: "Search the club's admin guide (how to do things in this system: switching branches, recording payments, freezing memberships, importing members, tasks...). Returns the most relevant sections.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
    async run(input) {
      let text = "";
      try {
        text = fs.readFileSync(GUIDE_PATH, "utf8");
      } catch (_error) {
        return { sections: [], note: "Admin guide not found." };
      }
      const sections = text.split(/\n(?=## )/);
      const words = String(input?.query || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const scored = sections
        .map((section) => ({ section, score: words.reduce((s, w) => s + (section.toLowerCase().includes(w) ? 1 : 0), 0) }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((s) => s.section.slice(0, 2500));
      return { sections: scored };
    }
  }
];

async function allowedTools(admin) {
  const out = [];
  for (const tool of TOOLS) {
    if (!tool.permission || admin.role === "super_admin" || (await rbacRepository.hasPermission(admin.id, admin.role, tool.permission))) {
      out.push(tool);
    }
  }
  return out;
}

function systemPrompt(scope) {
  const branches = scope.branchIds.map((id) => scope.branchNames[id]).join(" + ");
  return [
    "You are the operations assistant inside the admin dashboard of Muscle and Fitness Center, a gym in Saudi Arabia.",
    `You are answering for: ${branches}${scope.consolidated ? " (consolidated view across branches)" : ""}. Your tools only ever return data for this scope; never speculate about other branches.`,
    "Use the tools to get facts before answering data questions; never invent numbers. If a tool cannot answer, say so.",
    "You cannot change anything: you have no tools that create, edit, delete, refund, message or notify. When the user wants an action (e.g. contact members, extend a membership), explain where to do it in the dashboard and, if helpful, write a draft message clearly labelled as a draft for staff to review and send themselves.",
    "Reply in the same language the user wrote in (Arabic or English). Be concise; use short lists or small tables. Money is in SAR (prices include 15% VAT). Dates are Asia/Riyadh.",
    "Zakat is an internal accounting topic: never suggest showing it to customers."
  ].join("\n");
}

async function runModel({ prompt, scope, admin }) {
  const tools = await allowedTools(admin);
  const toolDefs = tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  const messages = [{ role: "user", content: `${prompt}\n\n(Today is ${today}.)` }];
  const toolsUsed = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await anthropic().beta.messages.create({
      model: env.aiModel,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: env.aiEffort },
      system: systemPrompt(scope),
      tools: toolDefs,
      messages
    });

    if (response.stop_reason === "refusal") {
      return { answer: null, refused: true, toolsUsed };
    }
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    const toolUses = response.content.filter((block) => block.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const answer = response.content.filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
      return { answer, toolsUsed, model: response.model };
    }

    messages.push({ role: "assistant", content: response.content });
    const results = await Promise.all(
      toolUses.map(async (block) => {
        const tool = byName.get(block.name);
        toolsUsed.push(block.name);
        if (!tool) {
          return { type: "tool_result", tool_use_id: block.id, content: "Unknown tool.", is_error: true };
        }
        try {
          const input = block.input && typeof block.input === "object" ? block.input : {};
          const output = await tool.run(input, scope);
          return { type: "tool_result", tool_use_id: block.id, content: JSON.stringify(output) };
        } catch (error) {
          appLogger.error({ error, tool: block.name }, "ai.tool_failed");
          return { type: "tool_result", tool_use_id: block.id, content: "The tool failed to run.", is_error: true };
        }
      })
    );
    messages.push({ role: "user", content: results });
  }
  return { answer: null, toolsUsed, exhausted: true };
}

// Offline fallback (flag on, no API key): the common questions, same scope.
async function ruleBasedAnswer(prompt, scope) {
  const text = String(prompt || "").toLowerCase();
  const ar = /[؀-ۿ]/.test(prompt);
  const kpis = await TOOLS[0].run({}, scope);
  if (/expir|renew|تنته|تجديد/.test(text)) {
    const data = await TOOLS[2].run({ within_days: 7 }, scope);
    return ar ? `${data.count} عضوية تنتهي خلال 7 أيام.` : `${data.count} memberships expire within 7 days.`;
  }
  if (/risk|inactive|منقطع|غياب/.test(text)) {
    return ar ? `${kpis.at_risk_members} عضوًا منقطعون حاليًا.` : `${kpis.at_risk_members} members are currently at risk (inactive).`;
  }
  return ar
    ? `الأعضاء النشطون: ${kpis.active_members}. الإيراد آخر 30 يومًا: ${kpis.revenue_30d.toFixed(2)} ريال. تنتهي خلال 7 أيام: ${kpis.expiring_7d}. منقطعون: ${kpis.at_risk_members}. (المساعد الذكي غير مهيأ؛ هذه إجابة مبسطة.)`
    : `Active members: ${kpis.active_members}. Revenue (30 days): SAR ${kpis.revenue_30d.toFixed(2)}. Expiring in 7 days: ${kpis.expiring_7d}. At risk: ${kpis.at_risk_members}. (AI is not configured; this is a basic answer.)`;
}

async function ask({ prompt, scope, admin, ipAddress = null }) {
  if (!env.aiAssistantEnabled) {
    throw createHttpError(404, "Not found.", "AI_DISABLED");
  }
  const question = String(prompt || "").trim().slice(0, 2000);
  if (!question) {
    throw createHttpError(422, "Ask a question first.", "AI_PROMPT_REQUIRED");
  }

  let result;
  let status = "success";
  try {
    if (env.anthropicApiKey) {
      const out = await runModel({ prompt: question, scope, admin });
      result = {
        mode: "ai",
        answer: out.answer || (out.refused ? "I can't help with that request." : "I couldn't finish that answer. Try asking more specifically."),
        toolsUsed: out.toolsUsed,
        refused: Boolean(out.refused)
      };
    } else {
      result = { mode: "basic", answer: await ruleBasedAnswer(question, scope), toolsUsed: [] };
    }
  } catch (error) {
    status = "failed";
    appLogger.error({ error: error.message, status: error.status }, "ai.ask_failed");
    result = { mode: "error", answer: null, error: "The assistant is unavailable right now. Please try again shortly." };
  }

  const logBranch = scope.branchIds.length === 1 ? scope.branchIds[0] : null;
  await query(
    `INSERT INTO ai_logs (branch_id, admin_user_id, prompt, intent, response, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [logBranch, admin.id, question, result.mode, JSON.stringify(result), status, admin.id, admin.id]
  ).catch(() => {});
  await createLog("admin", admin.id, "ai.query", "ai_logs", null, { mode: result.mode, tools: result.toolsUsed || [], consolidated: scope.consolidated }, ipAddress, logBranch);
  if (status === "failed") {
    throw createHttpError(503, result.error, "AI_UNAVAILABLE");
  }
  return result;
}

// Deterministic daily insights for the dashboard (no model call, no cost).
async function insights(scope) {
  const ids = scope.branchIds;
  const [rev] = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN completed_at >= DATE_FORMAT(UTC_DATE(), '%Y-%m-01') THEN amount END), 0) AS this_month,
       COALESCE(SUM(CASE WHEN completed_at >= DATE_FORMAT(UTC_DATE() - INTERVAL 1 MONTH, '%Y-%m-01')
                          AND completed_at < UTC_DATE() - INTERVAL 1 MONTH + INTERVAL 1 DAY THEN amount END), 0) AS last_month_to_date,
       SUM(CASE WHEN purpose = 'renewal' AND completed_at >= DATE_FORMAT(UTC_DATE(), '%Y-%m-01') THEN 1 ELSE 0 END) AS renewals_this_month,
       SUM(CASE WHEN purpose = 'renewal' AND completed_at >= DATE_FORMAT(UTC_DATE() - INTERVAL 1 MONTH, '%Y-%m-01')
                 AND completed_at < UTC_DATE() - INTERVAL 1 MONTH + INTERVAL 1 DAY THEN 1 ELSE 0 END) AS renewals_last_month_to_date
     FROM payments WHERE status = 'completed' AND branch_id IN (${inList(ids)})`,
    ids
  );
  const kpis = await TOOLS[0].run({}, scope);
  const pct = (now, before) => (Number(before) > 0 ? Math.round(((Number(now) - Number(before)) / Number(before)) * 100) : null);
  const items = [];
  const revChange = pct(rev.this_month, rev.last_month_to_date);
  if (revChange !== null) {
    items.push({
      tone: revChange >= 0 ? "good" : "warn",
      en: `Revenue is ${revChange >= 0 ? "up" : "down"} ${Math.abs(revChange)}% versus the same point last month.`,
      ar: `الإيراد ${revChange >= 0 ? "أعلى" : "أقل"} بنسبة ${Math.abs(revChange)}% مقارنة بنفس الفترة من الشهر الماضي.`
    });
  }
  const renChange = pct(rev.renewals_this_month, rev.renewals_last_month_to_date);
  if (renChange !== null) {
    items.push({
      tone: renChange >= 0 ? "good" : "warn",
      en: `Renewals are ${renChange >= 0 ? "up" : "down"} ${Math.abs(renChange)}% versus the same point last month.`,
      ar: `التجديدات ${renChange >= 0 ? "أعلى" : "أقل"} بنسبة ${Math.abs(renChange)}% مقارنة بنفس الفترة من الشهر الماضي.`
    });
  }
  if (kpis.expiring_7d > 0) {
    items.push({ tone: "info", en: `${kpis.expiring_7d} memberships expire in the next 7 days.`, ar: `${kpis.expiring_7d} عضوية تنتهي خلال 7 أيام.` });
  }
  if (kpis.at_risk_members > 0) {
    items.push({ tone: "warn", en: `${kpis.at_risk_members} active members have stopped visiting.`, ar: `${kpis.at_risk_members} عضوًا نشطًا انقطعوا عن الحضور.` });
  }
  if (kpis.pending_payments > 0) {
    items.push({ tone: "info", en: `${kpis.pending_payments} payments are still pending.`, ar: `${kpis.pending_payments} دفعة ما زالت معلّقة.` });
  }
  return { items, kpis };
}

module.exports = { TOOLS, ask, insights };
