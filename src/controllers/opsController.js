// Audit-log viewer and the admin notification bell (Part 2 §2.0.9).
//
// Audit log: read-only, paginated, filterable, exportable. Scope = the
// effective branch plus un-tagged (branch_id NULL) rows -- the existing
// convention for logs written before branch tagging -- or, for cross-branch
// admins with ?scope=all, every row.
//
// Bell feed: derived from records the branch already has (new leads,
// completed / failed payments, new members, open tasks assigned to me,
// memberships expiring tomorrow) over the last 7 days. "Unread" = newer than
// admin_users.notifications_seen_at.

const { query } = require("../config/database");
const excelExportService = require("../services/excelExportService");
const { canSwitchBranch } = require("../security/branchAccess");
const { cleanString, positiveInteger } = require("../utils/validator");
const { createHttpError } = require("../utils/httpError");
const { createLog } = require("../utils/logger");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function auditFilters(req) {
  const where = [];
  const params = [];
  if (String(req.query.scope || "") === "all") {
    if (!(await canSwitchBranch(req.user))) throw createHttpError(403, "Cross-branch access is required.", "AUDIT_SCOPE_FORBIDDEN");
  } else {
    if (!req.effectiveBranchId) throw createHttpError(403, "No branch in scope.", "BRANCH_REQUIRED");
    where.push("(l.branch_id = ? OR l.branch_id IS NULL)");
    params.push(req.effectiveBranchId);
  }
  const action = cleanString(req.query.action, 100);
  if (action) {
    where.push("l.action LIKE ?");
    params.push(`${action}%`);
  }
  const actorType = cleanString(req.query.actorType, 10);
  if (["admin", "user"].includes(actorType)) {
    where.push("l.actor_type = ?");
    params.push(actorType);
  }
  const actorId = Number.parseInt(req.query.actorId, 10);
  if (Number.isInteger(actorId)) {
    where.push("l.actor_id = ?");
    params.push(actorId);
  }
  const resource = cleanString(req.query.resource, 100);
  if (resource) {
    where.push("l.target_table = ?");
    params.push(resource);
  }
  if (DATE_RE.test(req.query.from || "")) {
    where.push("l.created_at >= ?");
    params.push(`${req.query.from} 00:00:00`);
  }
  if (DATE_RE.test(req.query.to || "")) {
    where.push("l.created_at <= ?");
    params.push(`${req.query.to} 23:59:59`);
  }
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

const AUDIT_SELECT = `SELECT l.id, l.created_at, l.actor_type, l.actor_id,
    COALESCE(a.full_name, u.full_name) AS actor_name, l.action, l.target_table, l.target_id,
    l.meta, l.ip_address, l.branch_id, b.name_en AS branch
  FROM logs l
  LEFT JOIN admin_users a ON l.actor_type = 'admin' AND a.id = l.actor_id
  LEFT JOIN users u ON l.actor_type = 'user' AND u.id = l.actor_id
  LEFT JOIN branches b ON b.id = l.branch_id`;

async function auditLogs(req, res) {
  const { where, params } = await auditFilters(req);
  const pageSize = positiveInteger(req.query.pageSize, 25, 100);
  const page = positiveInteger(req.query.page, 1, 1000000);
  const rows = await query(`${AUDIT_SELECT} ${where} ORDER BY l.created_at DESC, l.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params);
  const [count] = await query(`SELECT COUNT(*) AS total FROM logs l ${where}`, params);
  res.json({ success: true, data: { items: rows, pagination: { page, pageSize, total: Number(count.total) } } });
}

async function exportAuditLogs(req, res) {
  const { where, params } = await auditFilters(req);
  const rows = await query(`${AUDIT_SELECT} ${where} ORDER BY l.created_at DESC LIMIT 50000`, params);
  await createLog("admin", req.user.id, "audit_logs.export", "logs", null, { rows: rows.length }, req.ip, req.effectiveBranchId);
  await excelExportService.sendWorkbook(
    res,
    `audit-log-${excelExportService.stamp()}.xlsx`,
    [{
      name: { en: "Audit log", ar: "سجل التدقيق" },
      columns: [
        { key: "created_at", en: "Time (UTC)", ar: "الوقت (UTC)", type: "datetime", width: 18 },
        { key: "actor_type", en: "Actor type", ar: "نوع المنفذ", width: 10 },
        { key: "actor_name", en: "Actor", ar: "المنفذ", width: 22 },
        { key: "action", en: "Action", ar: "الإجراء", width: 26 },
        { key: "target_table", en: "Resource", ar: "المورد", width: 16 },
        { key: "target_id", en: "Resource #", ar: "رقم المورد", width: 10 },
        { key: "branch", en: "Branch", ar: "الفرع", width: 16 },
        { key: "ip_address", en: "IP", ar: "IP", width: 16 },
        { key: "meta_text", en: "Details", ar: "التفاصيل", width: 60 }
      ],
      rows: rows.map((row) => ({ ...row, meta_text: row.meta ? JSON.stringify(row.meta) : "" }))
    }],
    excelExportService.exportLang(req)
  );
}

async function feed(req, res) {
  const branchId = req.effectiveBranchId;
  if (!branchId) throw createHttpError(403, "No branch in scope.", "BRANCH_REQUIRED");
  const [me] = await query("SELECT notifications_seen_at FROM admin_users WHERE id = ?", [req.user.id]);
  const seenAt = me?.notifications_seen_at ? new Date(me.notifications_seen_at) : null;
  const window = "UTC_TIMESTAMP() - INTERVAL 7 DAY";
  const [leads, paid, failed, members, tasks, expiring] = await Promise.all([
    query(`SELECT id, name, created_at FROM messages WHERE branch_id = ? AND created_at >= ${window} ORDER BY created_at DESC LIMIT 20`, [branchId]),
    query(
      `SELECT p.id, p.amount, p.payment_method, p.completed_at AS created_at, u.full_name FROM payments p JOIN users u ON u.id = p.user_id
       WHERE p.branch_id = ? AND p.status = 'completed' AND p.completed_at >= ${window} ORDER BY p.completed_at DESC LIMIT 20`,
      [branchId]
    ),
    query(
      `SELECT p.id, p.amount, p.updated_at AS created_at, u.full_name FROM payments p JOIN users u ON u.id = p.user_id
       WHERE p.branch_id = ? AND p.status = 'failed' AND p.updated_at >= ${window} ORDER BY p.updated_at DESC LIMIT 20`,
      [branchId]
    ),
    query(`SELECT id, full_name, created_at FROM users WHERE branch_id = ? AND deleted_at IS NULL AND created_at >= ${window} ORDER BY created_at DESC LIMIT 20`, [branchId]),
    query(
      `SELECT id, title, priority, created_at FROM tasks WHERE branch_id = ? AND assigned_to = ? AND status IN ('open','in_progress') ORDER BY created_at DESC LIMIT 20`,
      [branchId, req.user.id]
    ),
    query(
      `SELECT COUNT(*) AS n FROM memberships WHERE branch_id = ? AND status = 'active' AND end_date = UTC_DATE() + INTERVAL 1 DAY`,
      [branchId]
    )
  ]);
  const items = [
    ...leads.map((r) => ({ type: "lead", id: r.id, at: r.created_at, tab: "messages", en: `New lead: ${r.name}`, ar: `عميل محتمل جديد: ${r.name}` })),
    ...paid.map((r) => ({ type: "payment", id: r.id, at: r.created_at, tab: "payments", en: `Payment received: SAR ${Number(r.amount).toFixed(2)} — ${r.full_name}`, ar: `دفعة مستلمة: ${Number(r.amount).toFixed(2)} ريال — ${r.full_name}` })),
    ...failed.map((r) => ({ type: "payment_failed", id: r.id, at: r.created_at, tab: "payments", en: `Payment failed — ${r.full_name}`, ar: `دفعة فاشلة — ${r.full_name}` })),
    ...members.map((r) => ({ type: "member", id: r.id, at: r.created_at, tab: "users", en: `New member: ${r.full_name}`, ar: `عضو جديد: ${r.full_name}` })),
    ...tasks.map((r) => ({ type: "task", id: r.id, at: r.created_at, tab: "tasks", en: `Task for you: ${r.title}`, ar: `مهمة مسندة إليك: ${r.title}` }))
  ]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 40)
    .map((item) => ({ ...item, unread: !seenAt || new Date(item.at) > seenAt }));
  if (Number(expiring[0].n) > 0) {
    items.unshift({ type: "expiring", at: new Date().toISOString(), tab: "users", unread: false, en: `${expiring[0].n} membership(s) expire tomorrow`, ar: `${expiring[0].n} عضوية تنتهي غدًا` });
  }
  res.json({ success: true, data: { items, unread: items.filter((item) => item.unread).length } });
}

async function markFeedSeen(req, res) {
  await query("UPDATE admin_users SET notifications_seen_at = UTC_TIMESTAMP() WHERE id = ?", [req.user.id]);
  res.json({ success: true, data: { seen: true } });
}

module.exports = { auditLogs, exportAuditLogs, feed, markFeedSeen };
