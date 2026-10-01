// Data import pipeline (Part 2 §2.4): parse -> validate -> preview -> commit.
//
// Generic over "entities" (only `members` today; adding one means adding an
// entry to ENTITIES with its columns, validateRows and commitRow). Rules:
//  - Nothing is written at preview time. The validated rows are stored in
//    import_jobs and the commit applies exactly that stored preview -- the
//    client only sends the job id back.
//  - Default mode only CREATES. "update" mode (explicit opt-in) matches on
//    member code and shows before/after for every changed field.
//  - Every row is re-checked at commit time (data may have changed since the
//    preview); a row that no longer applies is skipped, never forced.
//  - Branch = the admin's server-derived effective branch. A job can only be
//    committed by an admin currently scoped to that branch, and only once.

const crypto = require("crypto");
const ExcelJS = require("exceljs");
const { query, transaction } = require("../config/database");
const customerRepository = require("../repositories/customerRepository");
const { cleanEmail, cleanString, isSaudiPhone, normalizeSaudiPhone } = require("../utils/validator");
const { createHttpError } = require("../utils/httpError");
const { createLog } = require("../utils/logger");

const MAX_ROWS = 2000;
const MAX_BYTES = 2 * 1024 * 1024;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Parsing (xlsx / csv from a data URL)
// ---------------------------------------------------------------------------

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === "," || char === ";") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
}

function cellText(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if (value.text) return String(value.text);
    if (value.result != null) return cellText(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
    if (value.hyperlink) return String(value.text || value.hyperlink).replace(/^mailto:/, "");
  }
  return String(value);
}

async function parseUpload({ dataUrl, fileName }) {
  const match = String(dataUrl || "").match(/^data:([^;,]*)(;base64)?,(.*)$/s);
  if (!match) {
    throw createHttpError(422, "Upload an .xlsx or .csv file.", "IMPORT_FILE_INVALID");
  }
  const buffer = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]), "utf8");
  if (buffer.length === 0 || buffer.length > MAX_BYTES) {
    throw createHttpError(422, "The file is empty or larger than 2 MB.", "IMPORT_FILE_SIZE");
  }
  const name = String(fileName || "").toLowerCase();
  const isXlsx = name.endsWith(".xlsx") || /spreadsheetml/.test(match[1]) || buffer.subarray(0, 2).toString() === "PK";
  if (isXlsx) {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer);
    } catch (_error) {
      throw createHttpError(422, "The Excel file could not be read.", "IMPORT_FILE_INVALID");
    }
    const sheet = workbook.worksheets[0];
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = [];
      for (let c = 1; c <= sheet.columnCount; c += 1) values.push(cellText(row.getCell(c).value).trim());
      rows.push(values);
    });
    return rows;
  }
  if (!name.endsWith(".csv") && !/csv|text\/plain/.test(match[1])) {
    throw createHttpError(422, "Upload an .xlsx or .csv file.", "IMPORT_FILE_INVALID");
  }
  return parseCsv(buffer.toString("utf8")).map((row) => row.map((cell) => String(cell).trim()));
}

// ---------------------------------------------------------------------------
// Members entity
// ---------------------------------------------------------------------------

const MEMBER_COLUMNS = [
  { key: "member_code", en: "member_code", ar: "رقم العضوية", note: { en: "Update mode only: identifies the member to update.", ar: "لوضع التحديث فقط: يحدد العضو المراد تحديثه." } },
  { key: "full_name", en: "full_name", ar: "الاسم الكامل", required: true },
  { key: "email", en: "email", ar: "البريد الإلكتروني", required: true },
  { key: "phone", en: "phone", ar: "الجوال", required: true, note: { en: "Saudi mobile, e.g. 0551234567", ar: "جوال سعودي مثل 0551234567" } },
  { key: "gender", en: "gender", ar: "الجنس", note: { en: "male / female", ar: "male / female" } },
  { key: "birth_date", en: "birth_date", ar: "تاريخ الميلاد", note: { en: "YYYY-MM-DD", ar: "YYYY-MM-DD" } },
  { key: "nationality", en: "nationality", ar: "الجنسية" },
  { key: "city", en: "city", ar: "المدينة" },
  { key: "plan", en: "plan", ar: "الباقة", note: { en: "Exact plan name (English or Arabic) of THIS branch. Leave empty for no membership.", ar: "اسم الباقة كما هو (عربي أو إنجليزي) في هذا الفرع. اتركه فارغًا لعدم إضافة عضوية." } },
  { key: "membership_start", en: "membership_start", ar: "بداية العضوية", note: { en: "YYYY-MM-DD (required with plan)", ar: "YYYY-MM-DD (مطلوب مع الباقة)" } },
  { key: "membership_end", en: "membership_end", ar: "نهاية العضوية", note: { en: "YYYY-MM-DD (required with plan)", ar: "YYYY-MM-DD (مطلوب مع الباقة)" } }
];

function headerIndex(headerRow) {
  const map = {};
  headerRow.forEach((cell, index) => {
    const label = String(cell || "").trim().toLowerCase();
    const column = MEMBER_COLUMNS.find((c) => c.en === label || c.ar === String(cell || "").trim());
    if (column && map[column.key] === undefined) map[column.key] = index;
  });
  return map;
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (DATE_RE.test(text)) return text;
  const dmY = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmY) return `${dmY[3]}-${dmY[2].padStart(2, "0")}-${dmY[1].padStart(2, "0")}`;
  return text;
}

function validDate(value) {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function validateMembers(rawRows, { branchId, mode }) {
  if (rawRows.length < 2) {
    throw createHttpError(422, "The file has no data rows under the header.", "IMPORT_EMPTY");
  }
  const columns = headerIndex(rawRows[0]);
  const missing = MEMBER_COLUMNS.filter((c) => c.required && columns[c.key] === undefined).map((c) => c.en);
  if (mode === "update" && columns.member_code === undefined) missing.push("member_code");
  if (missing.length) {
    throw createHttpError(422, `Missing column(s): ${missing.join(", ")}. Use the template.`, "IMPORT_COLUMNS_MISSING");
  }
  const dataRows = rawRows.slice(1);
  if (dataRows.length > MAX_ROWS) {
    throw createHttpError(422, `Import at most ${MAX_ROWS} rows at a time.`, "IMPORT_TOO_MANY_ROWS");
  }

  const plans = await query(
    "SELECT id, name_en, name_ar, duration_days FROM plans WHERE branch_id = ? AND deleted_at IS NULL AND is_active = 1",
    [branchId]
  );
  const planByName = new Map();
  plans.forEach((plan) => {
    planByName.set(String(plan.name_en).trim().toLowerCase(), plan);
    planByName.set(String(plan.name_ar).trim(), plan);
  });

  const get = (row, key) => (columns[key] === undefined ? "" : String(row[columns[key]] || "").trim());
  const parsed = dataRows.map((row, index) => {
    const data = {
      memberCode: get(row, "member_code").toUpperCase(),
      fullName: cleanString(get(row, "full_name"), 160),
      email: cleanEmail(get(row, "email")),
      phone: normalizeSaudiPhone(get(row, "phone")),
      gender: get(row, "gender").toLowerCase(),
      birthDate: normalizeDate(get(row, "birth_date")),
      nationality: cleanString(get(row, "nationality"), 80),
      city: cleanString(get(row, "city"), 120),
      plan: get(row, "plan"),
      membershipStart: normalizeDate(get(row, "membership_start")),
      membershipEnd: normalizeDate(get(row, "membership_end"))
    };
    if (data.phone.startsWith("5")) data.phone = `0${data.phone}`;
    const reasons = [];
    if (data.fullName.length < 2) reasons.push("full_name is required");
    if (!EMAIL_RE.test(data.email)) reasons.push("email is not valid");
    if (!isSaudiPhone(data.phone)) reasons.push("phone is not a valid Saudi mobile");
    if (data.gender && !["male", "female"].includes(data.gender)) reasons.push("gender must be male or female");
    if (data.birthDate && !validDate(data.birthDate)) reasons.push("birth_date must be YYYY-MM-DD");
    let plan = null;
    if (data.plan) {
      plan = planByName.get(data.plan.toLowerCase()) || planByName.get(data.plan);
      if (!plan) reasons.push(`plan "${data.plan}" does not exist in this branch`);
      if (!validDate(data.membershipStart) || !validDate(data.membershipEnd)) reasons.push("membership_start and membership_end (YYYY-MM-DD) are required with a plan");
      else if (data.membershipEnd < data.membershipStart) reasons.push("membership_end is before membership_start");
    } else if (data.membershipStart || data.membershipEnd) {
      reasons.push("membership dates need a plan");
    }
    if (mode === "update" && !data.memberCode) reasons.push("member_code is required in update mode");
    return { row: index + 2, data: { ...data, planId: plan ? plan.id : null }, reasons };
  });

  // Duplicates inside the file.
  const seen = { email: new Map(), phone: new Map() };
  parsed.forEach((item) => {
    for (const key of ["email", "phone"]) {
      const value = item.data[key];
      if (!value) continue;
      if (seen[key].has(value)) item.reasons.push(`duplicate ${key} in file (row ${seen[key].get(value)})`);
      else seen[key].set(value, item.row);
    }
  });

  // Against this branch's existing members.
  for (const item of parsed) {
    if (item.reasons.length) continue;
    const { data } = item;
    if (mode === "update") {
      const rows = await query(
        "SELECT id, full_name, email, phone FROM users WHERE branch_id = ? AND member_code = ? AND deleted_at IS NULL LIMIT 1",
        [branchId, data.memberCode]
      );
      const existing = rows[0];
      if (!existing) {
        item.reasons.push(`member_code ${data.memberCode} not found in this branch`);
        continue;
      }
      const conflict = await query(
        "SELECT id FROM users WHERE branch_id = ? AND id <> ? AND deleted_at IS NULL AND (email = ? OR phone = ?) LIMIT 1",
        [branchId, existing.id, data.email, data.phone]
      );
      if (conflict[0]) {
        item.reasons.push("email or phone belongs to another member");
        continue;
      }
      const before = { full_name: existing.full_name, email: existing.email, phone: existing.phone };
      const after = { full_name: data.fullName, email: data.email, phone: data.phone };
      const changes = Object.keys(after).filter((key) => String(before[key] || "") !== String(after[key] || ""));
      item.targetId = existing.id;
      item.before = before;
      item.changes = changes;
      item.action = changes.length || data.planId ? "update" : "unchanged";
    } else {
      const rows = await query(
        "SELECT member_code FROM users WHERE branch_id = ? AND deleted_at IS NULL AND (email = ? OR phone = ?) LIMIT 1",
        [branchId, data.email, data.phone]
      );
      if (rows[0]) item.reasons.push(`already a member in this branch (${rows[0].member_code || "existing"})`);
      else item.action = "create";
    }
  }
  return parsed.map((item) => ({ ...item, action: item.reasons.length ? "skip" : item.action }));
}

async function commitMemberRow(item, { branchId, mode, adminId }) {
  const { data } = item;
  if (mode === "update") {
    return transaction(async (connection) => {
      const [rows] = await connection.execute("SELECT id FROM users WHERE id = ? AND branch_id = ? AND deleted_at IS NULL FOR UPDATE", [item.targetId, branchId]);
      if (!rows[0]) throw createHttpError(409, "Member no longer exists.", "IMPORT_ROW_STALE");
      await connection.execute(
        "UPDATE users SET full_name = ?, email = ?, phone = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?",
        [data.fullName, data.email, data.phone, item.targetId]
      );
      if (data.planId) await insertImportedMembership(connection, { branchId, userId: item.targetId, data, adminId });
      return { userId: item.targetId };
    });
  }
  const created = await customerRepository.createCustomer(
    {
      branchId,
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      gender: data.gender || "unspecified",
      birthDate: data.birthDate || null,
      nationality: data.nationality,
      city: data.city,
      // Random password: the member sets their own via "forgot password".
      password: crypto.randomBytes(18).toString("base64url")
    },
    adminId
  );
  if (data.planId) {
    await transaction((connection) => insertImportedMembership(connection, { branchId, userId: created.id, data, adminId }));
  }
  return { userId: created.id };
}

// Membership carried over from a previous system: no payment or invoice is
// created here (it was paid outside this system); a note records it.
async function insertImportedMembership(connection, { branchId, userId, data, adminId }) {
  const today = new Date().toISOString().slice(0, 10);
  const status = data.membershipEnd >= today ? "active" : "expired";
  if (status === "active") {
    const [active] = await connection.execute("SELECT id FROM memberships WHERE user_id = ? AND status = 'active' LIMIT 1", [userId]);
    if (active[0]) throw createHttpError(409, "Member already has an active membership.", "IMPORT_ROW_STALE");
  }
  await connection.execute(
    "INSERT INTO memberships (branch_id, user_id, plan_id, status, start_date, end_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [branchId, userId, data.planId, status, data.membershipStart, data.membershipEnd, adminId]
  );
  await connection.execute(
    "INSERT INTO customer_notes (user_id, note, visibility, created_by, updated_by) VALUES (?, ?, 'internal', ?, ?)",
    [userId, `Membership imported (${data.membershipStart} -> ${data.membershipEnd}); paid outside this system, no invoice issued.`, adminId, adminId]
  );
}

const ENTITIES = {
  members: { columns: MEMBER_COLUMNS, validate: validateMembers, commitRow: commitMemberRow }
};

function entityOf(name) {
  const entity = ENTITIES[name];
  if (!entity) throw createHttpError(404, "Unknown import type.", "IMPORT_ENTITY_UNKNOWN");
  return entity;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function preview({ entity: entityName, mode = "create", dataUrl, fileName, branchId, adminId, ipAddress }) {
  const entity = entityOf(entityName);
  const importMode = mode === "update" ? "update" : "create";
  const rawRows = await parseUpload({ dataUrl, fileName });
  const rows = await entity.validate(rawRows, { branchId, mode: importMode });
  const valid = rows.filter((row) => ["create", "update"].includes(row.action)).length;
  const result = await query(
    `INSERT INTO import_jobs (branch_id, entity, mode, file_name, status, total_rows, valid_rows, skipped_rows, rows_json, created_by)
     VALUES (?, ?, ?, ?, 'preview', ?, ?, ?, ?, ?)`,
    [branchId, entityName, importMode, cleanString(fileName, 255) || null, rows.length, valid, rows.length - valid, JSON.stringify(rows), adminId]
  );
  await createLog("admin", adminId, "import.preview", "import_jobs", result.insertId, { entity: entityName, mode: importMode, total: rows.length, valid }, ipAddress, branchId);
  return {
    jobId: result.insertId,
    mode: importMode,
    counts: {
      total: rows.length,
      create: rows.filter((r) => r.action === "create").length,
      update: rows.filter((r) => r.action === "update").length,
      unchanged: rows.filter((r) => r.action === "unchanged").length,
      skip: rows.filter((r) => r.action === "skip").length
    },
    rows: rows.slice(0, 500).map(({ row, action, reasons, data, before, changes }) => ({
      row,
      action,
      reasons,
      data: { memberCode: data.memberCode, fullName: data.fullName, email: data.email, phone: data.phone, plan: data.plan, membershipEnd: data.membershipEnd },
      before,
      changes
    }))
  };
}

async function commit({ jobId, branchId, adminId, ipAddress }) {
  const claimed = await query(
    "UPDATE import_jobs SET status = 'committed', committed_by = ?, committed_at = UTC_TIMESTAMP() WHERE id = ? AND branch_id = ? AND status = 'preview' AND created_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY",
    [adminId, jobId, branchId]
  );
  if (!claimed.affectedRows) {
    const rows = await query("SELECT status, branch_id FROM import_jobs WHERE id = ?", [jobId]);
    if (!rows[0] || Number(rows[0].branch_id) !== Number(branchId)) throw createHttpError(404, "Import not found.", "IMPORT_NOT_FOUND");
    throw createHttpError(409, "This import was already committed or has expired. Upload the file again.", "IMPORT_NOT_PENDING");
  }
  const [job] = await query("SELECT entity, mode, rows_json FROM import_jobs WHERE id = ?", [jobId]);
  const entity = entityOf(job.entity);
  const rows = JSON.parse(job.rows_json || "[]");
  const results = [];
  for (const item of rows) {
    if (!["create", "update"].includes(item.action)) continue;
    try {
      const out = await entity.commitRow(item, { branchId, mode: job.mode, adminId });
      results.push({ row: item.row, status: "done", userId: out.userId });
    } catch (error) {
      results.push({ row: item.row, status: "skipped", reason: error.statusCode && error.statusCode < 500 ? error.message : "Unexpected error" });
    }
  }
  const done = results.filter((r) => r.status === "done").length;
  await query("UPDATE import_jobs SET committed_rows = ?, result_json = ? WHERE id = ?", [done, JSON.stringify(results), jobId]);
  await createLog("admin", adminId, "import.commit", "import_jobs", jobId, { entity: job.entity, mode: job.mode, committed: done, skipped: results.length - done }, ipAddress, branchId);
  return { jobId, committed: done, skipped: results.filter((r) => r.status !== "done") };
}

async function template(entityName, lang = "en") {
  const entity = entityOf(entityName);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("members");
  sheet.columns = entity.columns.map((column) => ({ header: column.en, key: column.key, width: 20 }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRow({
    member_code: "",
    full_name: "Sara Alqahtani",
    email: "sara@example.com",
    phone: "0551234567",
    gender: "female",
    birth_date: "1995-04-12",
    nationality: "Saudi",
    city: "Jazan",
    plan: "",
    membership_start: "",
    membership_end: ""
  });
  const help = workbook.addWorksheet(lang === "ar" ? "التعليمات" : "Instructions", { views: [{ rightToLeft: lang === "ar" }] });
  help.columns = [
    { header: lang === "ar" ? "العمود" : "Column", key: "col", width: 20 },
    { header: lang === "ar" ? "مطلوب" : "Required", key: "req", width: 10 },
    { header: lang === "ar" ? "ملاحظات" : "Notes", key: "note", width: 80 }
  ];
  help.getRow(1).font = { bold: true };
  entity.columns.forEach((column) =>
    help.addRow({ col: column.en, req: column.required ? (lang === "ar" ? "نعم" : "yes") : "", note: column.note ? column.note[lang] || column.note.en : column[lang] })
  );
  help.addRow({});
  help.addRow({
    note:
      lang === "ar"
        ? "يُستورد الأعضاء إلى الفرع الذي تعرضه حاليًا. لا تُستبدل البيانات الحالية إلا في وضع التحديث. الحد الأقصى 2000 صف."
        : "Members are imported into the branch you are currently viewing. Existing data is only changed in update mode. Max 2000 rows."
  });
  return workbook.xlsx.writeBuffer();
}

module.exports = { MEMBER_COLUMNS, commit, parseCsv, preview, template };
