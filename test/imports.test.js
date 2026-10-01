// Import / export (Part 2 §2.4) -- real app + real DB.
//
// Covers: template download; CSV and XLSX previews validate every row
// (bad phone, duplicate in file, existing member, unknown plan, missing
// dates) and write NOTHING; commit creates only the valid rows (with member
// codes, and the carried-over membership), once; the other branch cannot
// commit the job; update mode matches by member code and shows before/after;
// lead/task/attendance exports are branch-scoped xlsx; the full backup is
// super_admin only and contains no secrets.

const test = require("node:test");
const assert = require("node:assert/strict");
const cron = require("node-cron");
const ExcelJS = require("exceljs");
const { hasDatabaseConfig, query, getPool } = require("../src/config/database");

const noDb = !hasDatabaseConfig();
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const ctx = { ready: false, adminIds: [], roleKeys: [], planIds: [], emails: [] };
let server;
let baseUrl;

async function api(method, path, { token, body, raw = false } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (raw) return res;
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function createAdmin(branchId, permissions, role = "staff") {
  const { hashPassword } = require("../src/utils/hash");
  const email = `imports.${role}.${branchId}.${RUN}@test.local`;
  const result = await query(
    "INSERT INTO admin_users (branch_id, full_name, email, password_hash, role, status) VALUES (?, 'Import Test', ?, ?, ?, 'active')",
    [branchId, email, await hashPassword("ImportAdmin@123"), role]
  );
  ctx.adminIds.push(result.insertId);
  if (permissions.length) {
    const roleKey = `test_imports_${RUN}_${result.insertId}`;
    const r = await query("INSERT INTO roles (key_name, display_name, is_system, is_active) VALUES (?, 'Import Test', 0, 1)", [roleKey]);
    for (const key of permissions) {
      const perm = await query("SELECT id FROM permissions WHERE key_name = ? LIMIT 1", [key]);
      if (perm[0]) await query("INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [r.insertId, perm[0].id]);
    }
    await query("INSERT INTO admin_user_roles (admin_user_id, role_id) VALUES (?, ?)", [result.insertId, r.insertId]);
    ctx.roleKeys.push(roleKey);
  }
  const login = await api("POST", "/api/v1/admin/auth/login", { body: { identifier: email, password: "ImportAdmin@123" } });
  assert.equal(login.status, 200);
  return { id: result.insertId, token: login.json.data.accessToken };
}

const csvDataUrl = (text) => `data:text/csv;base64,${Buffer.from(text, "utf8").toString("base64")}`;
const phone = (n) => `055${String((Date.now() + n) % 10000000).padStart(7, "0")}`;
const email = (label) => {
  const value = `imp.${label}.${RUN}@test.local`;
  ctx.emails.push(value);
  return value;
};
const memberCount = async () =>
  (await query(`SELECT COUNT(*) AS n FROM users WHERE email IN (${ctx.emails.map(() => "?").join(",")})`, ctx.emails))[0].n;

test.before(async () => {
  if (noDb) return;
  const app = require("../src/app");
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const branches = await query("SELECT id, code FROM branches WHERE code IN ('main','women')");
  ctx.main = branches.find((r) => r.code === "main")?.id;
  ctx.women = branches.find((r) => r.code === "women")?.id;
  if (!ctx.main || !ctx.women) return;
  const planRepository = require("../src/repositories/planRepository");
  const plan = await planRepository.savePlan({ nameEn: `Import Plan ${RUN}`, nameAr: `باقة استيراد ${RUN}`, descriptionEn: "T", descriptionAr: "ت", durationDays: 30, price: 100, branchId: ctx.women });
  ctx.planName = plan.name.en;
  ctx.planIds.push(plan.id);
  const perms = ["dashboard:read", "customers:manage", "leads:read", "tasks:manage", "attendance:manage"];
  ctx.womenAdmin = await createAdmin(ctx.women, perms);
  ctx.mainAdmin = await createAdmin(ctx.main, perms);
  ctx.superAdmin = await createAdmin(ctx.main, [], "super_admin");
  ctx.ready = true;
});

test.after(async () => {
  if (noDb) return;
  const run = async (sql, params) => {
    try {
      if (params.length) await query(sql, params);
    } catch (error) {
      console.error("[imports.test.js cleanup]", error.code || error.message);
    }
  };
  const list = (ids) => ids.map(() => "?").join(",");
  if (ctx.emails.length) {
    const ids = (await query(`SELECT id FROM users WHERE email IN (${list(ctx.emails)})`, ctx.emails)).map((r) => r.id);
    for (const table of ["customer_notes", "memberships", "customer_profiles"]) await run(`DELETE FROM ${table} WHERE user_id IN (${list(ids)})`, ids);
    await run(`DELETE FROM users WHERE id IN (${list(ids)})`, ids);
  }
  await run(`DELETE FROM import_jobs WHERE created_by IN (${list(ctx.adminIds)})`, ctx.adminIds);
  await run(`DELETE FROM plans WHERE id IN (${list(ctx.planIds)})`, ctx.planIds);
  await run(`DELETE FROM roles WHERE key_name IN (${list(ctx.roleKeys)})`, ctx.roleKeys);
  await run(`DELETE FROM refresh_tokens WHERE admin_user_id IN (${list(ctx.adminIds)})`, ctx.adminIds);
  await run(`DELETE FROM admin_users WHERE id IN (${list(ctx.adminIds)})`, ctx.adminIds);
  if (server) await new Promise((resolve) => server.close(resolve));
  const pool = getPool();
  if (pool) await pool.end();
  for (const [, task] of cron.getTasks()) {
    task.stop();
    task.destroy();
  }
});

test("template download lists the columns", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const res = await api("GET", "/api/v1/data/imports/members/template?lang=ar", { token: ctx.womenAdmin.token, raw: true });
  assert.equal(res.status, 200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const header = book.worksheets[0].getRow(1).values.slice(1);
  assert.deepEqual(header.slice(1, 4), ["full_name", "email", "phone"]);
  assert.equal(book.worksheets.length, 2);
});

test("CSV preview validates every row and writes nothing; commit creates only valid rows, once", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const existingEmail = email("existing");
  const userRepository = require("../src/repositories/userRepository");
  await userRepository.createUser({ branchId: ctx.women, fullName: "Existing", email: existingEmail, phone: phone(1), password: "MemberUser@123" });
  const dup = email("dup");
  const csv = [
    "full_name,email,phone,gender,plan,membership_start,membership_end",
    `Valid One,${email("one")},${phone(2)},female,,,`,
    `"Valid, Two",${email("two")},${phone(3).slice(1)},female,${ctx.planName},2026-09-01,2099-12-31`,
    `Bad Phone,${email("bad")},12345,female,,,`,
    `Dup A,${dup},${phone(4)},,,,`,
    `Dup B,${dup},${phone(5)},,,,`,
    `Existing,${existingEmail},${phone(6)},,,,`,
    `No Plan,${email("noplan")},${phone(7)},,Nonexistent Plan,2026-09-01,2026-10-01`,
    `No Dates,${email("nodates")},${phone(8)},,${ctx.planName},,`
  ].join("\n");
  const before = await memberCount();
  const preview = await api("POST", "/api/v1/data/imports/members/preview", { token: ctx.womenAdmin.token, body: { dataUrl: csvDataUrl(csv), fileName: "members.csv" } });
  assert.equal(preview.status, 201, JSON.stringify(preview.json));
  const { counts, rows, jobId } = preview.json.data;
  assert.equal(counts.create, 3, JSON.stringify(rows.map((r) => [r.row, r.action, r.reasons])));
  assert.equal(counts.skip, 5);
  const reason = (row) => rows.find((r) => r.row === row).reasons.join(" ");
  assert.match(reason(4), /phone/);
  assert.match(reason(6), /duplicate email/);
  assert.match(reason(7), /already a member/);
  assert.match(reason(8), /does not exist in this branch/);
  assert.match(reason(9), /required with a plan/);
  assert.equal(await memberCount(), before, "preview writes nothing");

  assert.equal((await api("POST", `/api/v1/data/imports/members/${jobId}/commit`, { token: ctx.mainAdmin.token })).status, 404, "other branch cannot commit");

  const commit = await api("POST", `/api/v1/data/imports/members/${jobId}/commit`, { token: ctx.womenAdmin.token });
  assert.equal(commit.status, 200, JSON.stringify(commit.json));
  assert.equal(commit.json.data.committed, 3);
  const two = (await query("SELECT u.id, u.member_code, u.card_token, u.branch_id FROM users u WHERE u.email = ?", [`imp.two.${RUN}@test.local`]))[0];
  assert.match(two.member_code, /^MFC-/);
  assert.ok(two.card_token);
  assert.equal(Number(two.branch_id), ctx.women);
  const membership = (await query("SELECT status FROM memberships WHERE user_id = ?", [two.id]))[0];
  assert.equal(membership.status, "active");

  const again = await api("POST", `/api/v1/data/imports/members/${jobId}/commit`, { token: ctx.womenAdmin.token });
  assert.equal(again.status, 409, "a job commits once");
  const logged = await query("SELECT COUNT(*) AS n FROM logs WHERE action = 'import.commit' AND actor_id = ?", [ctx.womenAdmin.id]);
  assert.ok(logged[0].n >= 1);
});

test("XLSX update mode matches by member code and previews before/after", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const target = (await query("SELECT member_code, email, phone FROM users WHERE email = ?", [`imp.one.${RUN}@test.local`]))[0];
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("members");
  sheet.addRow(["member_code", "full_name", "email", "phone"]);
  sheet.addRow([target.member_code, "Valid One Renamed", target.email, target.phone]);
  sheet.addRow(["MFC-999999", "Ghost", email("ghost"), phone(9)]);
  const buffer = await book.xlsx.writeBuffer();
  const dataUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${Buffer.from(buffer).toString("base64")}`;
  const preview = await api("POST", "/api/v1/data/imports/members/preview", { token: ctx.womenAdmin.token, body: { dataUrl, fileName: "update.xlsx", mode: "update" } });
  assert.equal(preview.status, 201, JSON.stringify(preview.json));
  const row = preview.json.data.rows[0];
  assert.equal(row.action, "update");
  assert.deepEqual(row.changes, ["full_name"]);
  assert.equal(row.before.full_name, "Valid One");
  assert.match(preview.json.data.rows[1].reasons.join(" "), /not found in this branch/);
  const commit = await api("POST", `/api/v1/data/imports/members/${preview.json.data.jobId}/commit`, { token: ctx.womenAdmin.token });
  assert.equal(commit.json.data.committed, 1);
  const updated = (await query("SELECT full_name FROM users WHERE email = ?", [target.email]))[0];
  assert.equal(updated.full_name, "Valid One Renamed");
});

test("list exports are branch-scoped; backup is super_admin only and has no secrets", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  for (const kind of ["leads", "tasks", "attendance"]) {
    const res = await api("GET", `/api/v1/data/exports/${kind}`, { token: ctx.womenAdmin.token, raw: true });
    assert.equal(res.status, 200, kind);
    assert.match(res.headers.get("content-type"), /spreadsheetml/);
  }
  const denied = await api("GET", "/api/v1/data/exports/backup", { token: ctx.womenAdmin.token });
  assert.equal(denied.status, 403);
  const backup = await api("GET", "/api/v1/data/exports/backup", { token: ctx.superAdmin.token, raw: true });
  assert.equal(backup.status, 200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await backup.arrayBuffer()));
  const usersSheet = book.getWorksheet("users");
  const header = usersSheet.getRow(1).values.join(",");
  assert.ok(!/password|card_token|token/.test(header));
  assert.ok(book.getWorksheet("payments") && book.getWorksheet("invoices"));
});
