// Excel exports for list screens that had none, the super_admin full backup
// workbook, and the member import endpoints (Part 2 §2.4).
//
// Every export is built from a query filtered by the server-derived
// effective branch (never a client branch id), respects the screen's own
// filters, and is audit-logged. The full backup is super_admin only and
// never contains secrets (password hashes, refresh tokens, QR card tokens,
// raw provider payloads).

const excelExportService = require("../services/excelExportService");
const importService = require("../services/importService");
const { query } = require("../config/database");
const { cleanString } = require("../utils/validator");
const { createHttpError } = require("../utils/httpError");
const { createLog } = require("../utils/logger");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const pickDate = (value) => (DATE_RE.test(value || "") ? value : "");

function requireBranch(req) {
  if (!req.effectiveBranchId) throw createHttpError(403, "No branch in scope.", "BRANCH_REQUIRED");
  return req.effectiveBranchId;
}

async function send(req, res, name, sheets, meta) {
  await createLog("admin", req.user.id, `${name}.export`, null, null, meta, req.ip, req.effectiveBranchId);
  await excelExportService.sendWorkbook(res, `${name}-${excelExportService.stamp()}.xlsx`, sheets, excelExportService.exportLang(req));
}

async function exportLeads(req, res) {
  const branchId = requireBranch(req);
  const where = ["m.branch_id = ?"];
  const params = [branchId];
  for (const [key, column] of [["status", "m.status"], ["leadStatus", "m.lead_status"], ["assignedTo", "m.assigned_to"]]) {
    const value = cleanString(req.query[key], 20);
    if (value) {
      where.push(`${column} = ?`);
      params.push(value);
    }
  }
  const search = cleanString(req.query.search, 160);
  if (search) {
    where.push("(m.name LIKE ? OR m.email LIKE ? OR m.phone LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const rows = await query(
    `SELECT m.id, m.created_at, m.name, m.email, m.phone, m.subject, m.lead_status, m.status, a.full_name AS assigned_to, u.member_code AS converted_member
     FROM messages m LEFT JOIN admin_users a ON a.id = m.assigned_to LEFT JOIN users u ON u.id = m.converted_user_id
     WHERE ${where.join(" AND ")} ORDER BY m.created_at DESC LIMIT 10000`,
    params
  );
  await send(req, res, "leads", [{
    name: { en: "Leads", ar: "العملاء المحتملون" },
    columns: [
      { key: "id", en: "#", ar: "#", width: 8 },
      { key: "created_at", en: "Received", ar: "تاريخ الوصول", type: "datetime", width: 18 },
      { key: "name", en: "Name", ar: "الاسم", width: 24 },
      { key: "email", en: "Email", ar: "البريد", width: 28 },
      { key: "phone", en: "Phone", ar: "الجوال", width: 16 },
      { key: "subject", en: "Subject", ar: "الموضوع", width: 28 },
      { key: "lead_status", en: "Lead status", ar: "حالة العميل", width: 14 },
      { key: "status", en: "Inbox", ar: "البريد الوارد", width: 12 },
      { key: "assigned_to", en: "Assigned to", ar: "المسؤول", width: 20 },
      { key: "converted_member", en: "Member code", ar: "رقم العضوية", width: 14 }
    ],
    rows
  }], { rows: rows.length });
}

async function exportTasks(req, res) {
  const branchId = requireBranch(req);
  const where = ["t.branch_id = ?"];
  const params = [branchId];
  for (const [key, column] of [["status", "t.status"], ["priority", "t.priority"], ["assignedTo", "t.assigned_to"]]) {
    const value = cleanString(req.query[key], 20);
    if (value) {
      where.push(`${column} = ?`);
      params.push(value);
    }
  }
  const rows = await query(
    `SELECT t.id, t.title, t.priority, t.status, t.due_date, a.full_name AS assignee, t.linked_resource_type, t.linked_resource_id, t.outcome_note, t.created_at
     FROM tasks t LEFT JOIN admin_users a ON a.id = t.assigned_to
     WHERE ${where.join(" AND ")} ORDER BY t.created_at DESC LIMIT 10000`,
    params
  );
  await send(req, res, "tasks", [{
    name: { en: "Tasks", ar: "المهام" },
    columns: [
      { key: "id", en: "#", ar: "#", width: 8 },
      { key: "title", en: "Title", ar: "العنوان", width: 40 },
      { key: "priority", en: "Priority", ar: "الأولوية", width: 10 },
      { key: "status", en: "Status", ar: "الحالة", width: 12 },
      { key: "due_date", en: "Due", ar: "الاستحقاق", type: "date", width: 12 },
      { key: "assignee", en: "Assigned to", ar: "المسؤول", width: 20 },
      { key: "linked_resource_type", en: "Linked to", ar: "مرتبط بـ", width: 12 },
      { key: "linked_resource_id", en: "Linked #", ar: "رقم السجل", width: 10 },
      { key: "outcome_note", en: "Outcome", ar: "النتيجة", width: 30 },
      { key: "created_at", en: "Created", ar: "تاريخ الإنشاء", type: "datetime", width: 18 }
    ],
    rows
  }], { rows: rows.length });
}

async function exportAttendance(req, res) {
  const branchId = requireBranch(req);
  const today = new Date().toISOString().slice(0, 10);
  const from = pickDate(req.query.from) || today;
  const to = pickDate(req.query.to) || today;
  const rows = await query(
    `SELECT a.id, CONVERT_TZ(a.check_in_at, '+00:00', '+03:00') AS check_in, CONVERT_TZ(a.check_out_at, '+00:00', '+03:00') AS check_out,
       u.full_name AS member, u.member_code, a.method, a.status
     FROM attendance_logs a JOIN users u ON u.id = a.user_id
     WHERE a.deleted_at IS NULL AND a.branch_id = ?
       AND DATE(CONVERT_TZ(a.check_in_at, '+00:00', '+03:00')) BETWEEN ? AND ?
     ORDER BY a.check_in_at DESC LIMIT 50000`,
    [branchId, from, to]
  );
  await send(req, res, "attendance", [{
    name: { en: "Attendance", ar: "الحضور" },
    columns: [
      { key: "check_in", en: "Check-in (Riyadh)", ar: "الدخول (توقيت الرياض)", type: "datetime", width: 20 },
      { key: "check_out", en: "Check-out (Riyadh)", ar: "الخروج", type: "datetime", width: 20 },
      { key: "member", en: "Member", ar: "العضو", width: 26 },
      { key: "member_code", en: "Member code", ar: "رقم العضوية", width: 14 },
      { key: "method", en: "Method", ar: "الطريقة", width: 10 },
      { key: "status", en: "Status", ar: "الحالة", width: 12 }
    ],
    rows
  }], { from, to, rows: rows.length });
}

// Full backup: one sheet per core table, all branches, super_admin only.
// Column lists are explicit so secrets can never slip in via SELECT *.
const BACKUP_TABLES = [
  ["branches", "id, code, name_en, name_ar, status, created_at"],
  ["users", "id, branch_id, member_code, full_name, email, phone, status, created_at, deleted_at"],
  ["customer_profiles", "user_id, branch_id, gender, birth_date, nationality, city, coach_id, created_at"],
  ["plans", "id, branch_id, name_en, name_ar, price, duration_days, bonus_days, is_active, deleted_at"],
  ["offers", "id, branch_id, title_en, title_ar, is_active, created_at"],
  ["memberships", "id, branch_id, user_id, plan_id, status, start_date, end_date, created_at"],
  ["membership_freezes", "id, branch_id, membership_id, user_id, reason, starts_on, ends_on, status"],
  ["payments", "id, branch_id, user_id, membership_id, plan_id, purpose, provider, payment_method, transaction_id, amount, currency, status, failure_reason, invoice_id, created_at, completed_at"],
  ["invoices", "id, branch_id, user_id, invoice_number, status, issue_date, issued_at, subtotal, tax_total, total, paid_total, balance_due, currency, buyer_name"],
  ["invoice_items", "id, invoice_id, plan_id, item_type, description, quantity, unit_price, tax_rate, tax_amount, line_total"],
  ["attendance_logs", "id, branch_id, user_id, membership_id, check_in_at, check_out_at, method, status"],
  ["coaches", "id, branch_id, name_en, name_ar, specialty_en, specialty_ar, years_experience, is_active, deleted_at"],
  ["messages", "id, branch_id, name, email, phone, subject, lead_status, status, created_at"],
  ["tasks", "id, branch_id, title, priority, status, due_date, assigned_to, linked_resource_type, linked_resource_id, created_at"],
  ["expenses", "id, branch_id, title, amount, currency, expense_date, status"]
];

async function exportBackup(req, res) {
  if (req.user?.role !== "super_admin") {
    throw createHttpError(403, "Only a super admin can download the full backup.", "BACKUP_FORBIDDEN");
  }
  const sheets = [];
  for (const [table, columns] of BACKUP_TABLES) {
    const rows = await query(`SELECT ${columns} FROM ${table} ORDER BY 1 LIMIT 200000`).catch(() => []);
    sheets.push({
      name: table,
      columns: columns.split(",").map((c) => c.trim()).map((key) => ({ key, en: key, ar: key, width: 16 })),
      rows
    });
  }
  await send(req, res, "full-backup", sheets, { tables: BACKUP_TABLES.length });
}

async function importTemplate(req, res) {
  const buffer = await importService.template(req.params.entity, excelExportService.exportLang(req));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${req.params.entity}-import-template.xlsx"`);
  res.send(Buffer.from(buffer));
}

async function importPreview(req, res) {
  const data = await importService.preview({
    entity: req.params.entity,
    mode: req.body?.mode,
    dataUrl: req.body?.dataUrl,
    fileName: req.body?.fileName,
    branchId: requireBranch(req),
    adminId: req.user.id,
    ipAddress: req.ip
  });
  res.status(201).json({ success: true, data });
}

async function importCommit(req, res) {
  const jobId = Number.parseInt(req.params.jobId, 10);
  if (!Number.isInteger(jobId)) throw createHttpError(404, "Import not found.", "IMPORT_NOT_FOUND");
  const data = await importService.commit({ jobId, branchId: requireBranch(req), adminId: req.user.id, ipAddress: req.ip });
  res.json({ success: true, data });
}

module.exports = { exportAttendance, exportBackup, exportLeads, exportTasks, importCommit, importPreview, importTemplate };
