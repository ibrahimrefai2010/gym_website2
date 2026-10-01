// Admin payments & invoicing (Part 2 §2.0.5): reception-recorded payments,
// the branch-scoped payments list, and Excel exports -- real app + real DB.
//
// Covers: a cash payment settles payment + membership + VAT-inclusive
// invoice together; the same submission key (sequential or concurrent)
// never creates a second payment; a member or plan from the other branch is
// a 404; lists and exports only ever contain the admin's own branch, and a
// non-switching admin's X-View-Branch header is ignored; exports are audit
// logged.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const cron = require("node-cron");
const { hasDatabaseConfig, query, getPool } = require("../src/config/database");

const noDb = !hasDatabaseConfig();
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const ctx = { ready: false, userIds: [], planIds: [], adminIds: [], roleKeys: [] };
let app;
let server;
let baseUrl;
let phoneSeq = 0;

function nextPhone() {
  phoneSeq += 1;
  return `054${String((Date.now() + phoneSeq) % 10000000).padStart(7, "0")}`;
}

async function api(method, path, { token, body, headers = {}, raw = false } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (raw) return res;
  let json = null;
  try {
    json = await res.json();
  } catch (_error) {
    json = null;
  }
  return { status: res.status, json };
}

async function createScopedAdmin(branchId, permissionKeys) {
  const { hashPassword } = require("../src/utils/hash");
  const email = `adminpay.${branchId}.${RUN}@test.local`;
  const password = "AdminPay@123";
  const result = await query(
    "INSERT INTO admin_users (branch_id, full_name, email, password_hash, role, status) VALUES (?, 'Pay Test Admin', ?, ?, 'staff', 'active')",
    [branchId, email, await hashPassword(password)]
  );
  const roleKey = `test_adminpay_${RUN}_${result.insertId}`;
  const role = await query("INSERT INTO roles (key_name, display_name, is_system, is_active) VALUES (?, 'Pay Test', 0, 1)", [roleKey]);
  for (const key of permissionKeys) {
    const perm = await query("SELECT id FROM permissions WHERE key_name = ? LIMIT 1", [key]);
    if (perm[0]) await query("INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [role.insertId, perm[0].id]);
  }
  await query("INSERT INTO admin_user_roles (admin_user_id, role_id) VALUES (?, ?)", [result.insertId, role.insertId]);
  ctx.adminIds.push(result.insertId);
  ctx.roleKeys.push(roleKey);
  const login = await api("POST", "/api/v1/admin/auth/login", { body: { identifier: email, password } });
  assert.equal(login.status, 200, "setup: admin login");
  return { id: result.insertId, token: login.json.data.accessToken };
}

async function createMember(branchId, label) {
  const userRepository = require("../src/repositories/userRepository");
  const user = await userRepository.createUser({
    branchId,
    fullName: `AdminPay ${label}`,
    email: `adminpay.${label}.${RUN}@test.local`,
    phone: nextPhone(),
    password: "MemberUser@123"
  });
  ctx.userIds.push(user.id);
  return user;
}

function manual(token, userId, planId, key = crypto.randomUUID(), method = "cash") {
  return api("POST", "/api/v1/payments/manual", { token, body: { userId, planId, method, idempotencyKey: key, reference: "RCPT-1" } });
}

test.before(async () => {
  if (noDb) return;
  app = require("../src/app");
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const branches = await query("SELECT id, code FROM branches WHERE code IN ('main','women')");
  const main = branches.find((row) => row.code === "main");
  const women = branches.find((row) => row.code === "women");
  if (!main || !women) return;
  ctx.mainBranchId = main.id;
  ctx.womenBranchId = women.id;

  const planRepository = require("../src/repositories/planRepository");
  for (const [key, branchId] of [["mainPlan", main.id], ["womenPlan", women.id]]) {
    const plan = await planRepository.savePlan({
      nameEn: `AdminPay Plan ${RUN}`,
      nameAr: "خطة اختبار",
      descriptionEn: "Test",
      descriptionAr: "اختبار",
      durationDays: 30,
      price: 115,
      branchId
    });
    ctx[key] = plan.id;
    ctx.planIds.push(plan.id);
  }
  const perms = ["dashboard:read", "payments:read", "payments:write", "invoices:read"];
  ctx.mainAdmin = await createScopedAdmin(main.id, perms);
  ctx.womenAdmin = await createScopedAdmin(women.id, perms);
  ctx.ready = true;
});

test.after(async () => {
  if (noDb) return;
  const tryRun = async (sql, params) => {
    try {
      if (params.length) await query(sql, params);
    } catch (error) {
      console.error("[adminPayments.test.js cleanup]", error.code || error.message);
    }
  };
  const list = (ids) => ids.map(() => "?").join(",");
  const users = ctx.userIds;
  if (users.length) {
    const invoiceIds = (await query(`SELECT id FROM invoices WHERE user_id IN (${list(users)})`, users)).map((r) => r.id);
    await tryRun(`UPDATE payments SET invoice_id = NULL WHERE user_id IN (${list(users)})`, users);
    await tryRun(`DELETE FROM invoice_items WHERE invoice_id IN (${list(invoiceIds)})`, invoiceIds);
    await tryRun(`DELETE FROM invoices WHERE id IN (${list(invoiceIds)})`, invoiceIds);
    await tryRun(`DELETE FROM payments WHERE user_id IN (${list(users)})`, users);
    await tryRun(`DELETE FROM memberships WHERE user_id IN (${list(users)})`, users);
    await tryRun(`DELETE FROM notifications WHERE user_id IN (${list(users)})`, users);
    await tryRun(`DELETE FROM users WHERE id IN (${list(users)})`, users);
  }
  await tryRun(`DELETE FROM plans WHERE id IN (${list(ctx.planIds)})`, ctx.planIds);
  await tryRun(`DELETE FROM roles WHERE key_name IN (${list(ctx.roleKeys)})`, ctx.roleKeys);
  await tryRun(`DELETE FROM admin_users WHERE id IN (${list(ctx.adminIds)})`, ctx.adminIds);
  if (server) await new Promise((resolve) => server.close(resolve));
  const pool = getPool();
  if (pool) await pool.end();
  for (const [, task] of cron.getTasks()) {
    task.stop();
    task.destroy();
  }
});

test("a reception cash payment settles payment, membership and invoice together", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const member = await createMember(ctx.mainBranchId, "cash");
  const res = await manual(ctx.mainAdmin.token, member.id, ctx.mainPlan);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.data.status, "completed");
  assert.match(res.json.data.invoiceNumber, /^INV-M-/);

  const payment = (await query("SELECT * FROM payments WHERE id = ?", [res.json.data.id]))[0];
  assert.equal(payment.payment_method, "cash");
  assert.equal(payment.provider, "manual");
  assert.equal(Number(payment.completed_by), ctx.mainAdmin.id);
  const membership = (await query("SELECT status FROM memberships WHERE id = ?", [payment.membership_id]))[0];
  assert.equal(membership.status, "active");
  const invoice = (await query("SELECT total, tax_total, subtotal FROM invoices WHERE id = ?", [payment.invoice_id]))[0];
  assert.equal(Number(invoice.total), 115);
  assert.equal(Number(invoice.tax_total), 15);
  assert.equal(Number(invoice.subtotal), 100);
});

test("the same submission key never records a second payment, even concurrently", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const member = await createMember(ctx.mainBranchId, "dupe");
  const key = crypto.randomUUID();
  const results = await Promise.all([1, 2, 3].map(() => manual(ctx.mainAdmin.token, member.id, ctx.mainPlan, key)));
  assert.ok(results.every((res) => res.status === 200 || res.status === 201), JSON.stringify(results.map((r) => r.json)));
  assert.equal(results.filter((res) => res.status === 201).length, 1);
  const again = await manual(ctx.mainAdmin.token, member.id, ctx.mainPlan, key);
  assert.equal(again.json.data.duplicate, true);
  assert.equal((await query("SELECT COUNT(*) AS n FROM payments WHERE user_id = ?", [member.id]))[0].n, 1);
  assert.equal((await query("SELECT COUNT(*) AS n FROM invoices WHERE user_id = ?", [member.id]))[0].n, 1);
});

test("a member or plan from the other branch is a 404", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const womenMember = await createMember(ctx.womenBranchId, "crossmember");
  const crossMember = await manual(ctx.mainAdmin.token, womenMember.id, ctx.mainPlan);
  assert.equal(crossMember.status, 404);
  const mainMember = await createMember(ctx.mainBranchId, "crossplan");
  const crossPlan = await manual(ctx.mainAdmin.token, mainMember.id, ctx.womenPlan);
  assert.equal(crossPlan.status, 404);
  assert.equal((await query("SELECT COUNT(*) AS n FROM payments WHERE user_id IN (?, ?)", [womenMember.id, mainMember.id]))[0].n, 0);
});

test("payments list and export only contain the admin's own branch", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const member = await createMember(ctx.womenBranchId, "listed");
  const paid = await manual(ctx.womenAdmin.token, member.id, ctx.womenPlan, crypto.randomUUID(), "bank_transfer");
  assert.equal(paid.status, 201);

  const womenList = await api("GET", `/api/v1/payments?search=${encodeURIComponent(`AdminPay listed`)}`, { token: ctx.womenAdmin.token });
  assert.ok(womenList.json.data.items.some((row) => row.id === paid.json.data.id));
  const mainList = await api("GET", `/api/v1/payments?search=${encodeURIComponent(`AdminPay listed`)}`, {
    token: ctx.mainAdmin.token,
    headers: { "X-View-Branch": String(ctx.womenBranchId) }
  });
  assert.equal(mainList.status, 200);
  assert.ok(!mainList.json.data.items.some((row) => row.id === paid.json.data.id), "spoofed X-View-Branch ignored");

  const xlsx = await api("GET", "/api/v1/payments/export?lang=ar", { token: ctx.womenAdmin.token, raw: true });
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.headers.get("content-type"), /spreadsheetml/);
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));
  const sheet = workbook.worksheets[0];
  const ids = [];
  sheet.eachRow((row, index) => index > 1 && ids.push(Number(row.getCell(1).value)));
  assert.ok(ids.includes(paid.json.data.id));
  const branchOfIds = await query(`SELECT DISTINCT branch_id FROM payments WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  assert.deepEqual(branchOfIds.map((r) => Number(r.branch_id)), [ctx.womenBranchId]);

  const invoices = await api("GET", "/api/v1/invoices/export", { token: ctx.womenAdmin.token, raw: true });
  assert.equal(invoices.status, 200);

  const logged = await query("SELECT COUNT(*) AS n FROM logs WHERE action = 'payments.export' AND actor_id = ?", [ctx.womenAdmin.id]);
  assert.ok(logged[0].n >= 1, "export is audit logged");
});
