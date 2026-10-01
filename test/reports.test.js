// Finance reports (Part 2 §2.0.6) -- real app + real DB.
//
// Covers: VAT figures per branch match the invoices issued; a branch-scoped
// admin only ever gets their own branch (a ?branchId= or X-View-Branch
// spoof changes nothing) and is refused the consolidated view; a
// cross-branch admin gets per-branch rows + a consolidated total that is
// their sum; Zakat worksheet inputs save per branch and read back, and the
// consolidated worksheet sums them; annual revenue and churn/renewal count
// the seeded events; exports are xlsx and audit-logged.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const cron = require("node-cron");
const { hasDatabaseConfig, query, getPool } = require("../src/config/database");

const noDb = !hasDatabaseConfig();
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const ctx = { ready: false, userIds: [], planIds: [], adminIds: [], roleKeys: [], zakatYear: null };
let server;
let baseUrl;
let phoneSeq = 0;

const nextPhone = () => `052${String((Date.now() + ++phoneSeq) % 10000000).padStart(7, "0")}`;

async function api(method, path, { token, body, headers = {}, raw = false } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (raw) return res;
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function createAdmin(branchId, { role = "staff", permissions = [] } = {}) {
  const { hashPassword } = require("../src/utils/hash");
  const email = `reports.${role}.${branchId}.${RUN}@test.local`;
  const password = "ReportsAdmin@123";
  const result = await query(
    "INSERT INTO admin_users (branch_id, full_name, email, password_hash, role, status) VALUES (?, 'Reports Test', ?, ?, ?, 'active')",
    [branchId, email, await hashPassword(password), role]
  );
  ctx.adminIds.push(result.insertId);
  if (permissions.length) {
    const roleKey = `test_reports_${RUN}_${result.insertId}`;
    const r = await query("INSERT INTO roles (key_name, display_name, is_system, is_active) VALUES (?, 'Reports Test', 0, 1)", [roleKey]);
    for (const key of permissions) {
      const perm = await query("SELECT id FROM permissions WHERE key_name = ? LIMIT 1", [key]);
      if (perm[0]) await query("INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [r.insertId, perm[0].id]);
    }
    await query("INSERT INTO admin_user_roles (admin_user_id, role_id) VALUES (?, ?)", [result.insertId, r.insertId]);
    ctx.roleKeys.push(roleKey);
  }
  const login = await api("POST", "/api/v1/admin/auth/login", { body: { identifier: email, password } });
  assert.equal(login.status, 200, "setup: admin login");
  return { id: result.insertId, token: login.json.data.accessToken };
}

async function paidMember(branchId, planId, adminId, label) {
  const userRepository = require("../src/repositories/userRepository");
  const paymentService = require("../src/services/paymentService");
  const user = await userRepository.createUser({ branchId, fullName: `Reports ${label}`, email: `reports.${label}.${RUN}@test.local`, phone: nextPhone(), password: "MemberUser@123" });
  ctx.userIds.push(user.id);
  const paid = await paymentService.recordManualPayment(adminId, branchId, { userId: user.id, planId, method: "cash", idempotencyKey: crypto.randomUUID() });
  return { user, paid };
}

const today = () => new Date().toISOString().slice(0, 10);

test.before(async () => {
  if (noDb) return;
  const app = require("../src/app");
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const branches = await query("SELECT id, code FROM branches WHERE code IN ('main','women')");
  const main = branches.find((r) => r.code === "main");
  const women = branches.find((r) => r.code === "women");
  if (!main || !women) return;
  ctx.main = main.id;
  ctx.women = women.id;

  const planRepository = require("../src/repositories/planRepository");
  for (const [key, branchId, price] of [["mainPlan", main.id, 230], ["womenPlan", women.id, 460]]) {
    const plan = await planRepository.savePlan({ nameEn: `Reports Plan ${RUN}`, nameAr: "خطة التقارير", descriptionEn: "T", descriptionAr: "ت", durationDays: 30, price, branchId });
    ctx[key] = plan.id;
    ctx.planIds.push(plan.id);
  }
  const perms = ["dashboard:read", "reports:read", "tax_reports:read"];
  ctx.mainAdmin = await createAdmin(main.id, { permissions: perms });
  ctx.womenAdmin = await createAdmin(women.id, { permissions: perms });
  ctx.superAdmin = await createAdmin(main.id, { role: "super_admin" });

  ctx.mainSale = await paidMember(main.id, ctx.mainPlan, ctx.mainAdmin.id, "main");
  ctx.womenSale = await paidMember(women.id, ctx.womenPlan, ctx.womenAdmin.id, "women");
  ctx.ready = true;
});

test.after(async () => {
  if (noDb) return;
  const run = async (sql, params) => {
    try {
      if (params.length) await query(sql, params);
    } catch (error) {
      console.error("[reports.test.js cleanup]", error.code || error.message);
    }
  };
  const list = (ids) => ids.map(() => "?").join(",");
  const users = ctx.userIds;
  if (users.length) {
    const invoiceIds = (await query(`SELECT id FROM invoices WHERE user_id IN (${list(users)})`, users)).map((r) => r.id);
    await run(`UPDATE payments SET invoice_id = NULL WHERE user_id IN (${list(users)})`, users);
    await run(`DELETE FROM invoice_items WHERE invoice_id IN (${list(invoiceIds)})`, invoiceIds);
    await run(`DELETE FROM invoices WHERE id IN (${list(invoiceIds)})`, invoiceIds);
    for (const table of ["payments", "memberships", "notifications"]) await run(`DELETE FROM ${table} WHERE user_id IN (${list(users)})`, users);
    await run(`DELETE FROM users WHERE id IN (${list(users)})`, users);
  }
  if (ctx.zakatYear) await run("DELETE FROM zakat_worksheets WHERE hijri_year = ? AND updated_by IN (?, ?)", [ctx.zakatYear, ctx.mainAdmin?.id || 0, ctx.womenAdmin?.id || 0]);
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

test("VAT report: branch-scoped figures, spoofing ignored, consolidated only for cross-branch admins", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const range = `from=${today()}&to=${today()}`;
  const mainVat = await api("GET", `/api/v1/reports/vat?${range}&branchId=${ctx.women}`, {
    token: ctx.mainAdmin.token,
    headers: { "X-View-Branch": String(ctx.women) }
  });
  assert.equal(mainVat.status, 200);
  assert.equal(mainVat.json.data.branches.length, 1);
  assert.equal(mainVat.json.data.branches[0].branch.id, ctx.main, "spoofed branch ignored");

  const invoice = (await query("SELECT tax_total FROM invoices WHERE id = ?", [ctx.mainSale.paid.invoiceId]))[0];
  assert.equal(Number(invoice.tax_total), 30); // 230 incl. 15% VAT
  const direct = (
    await query("SELECT COALESCE(SUM(tax_total),0) AS vat FROM invoices WHERE branch_id = ? AND issue_date = ? AND status NOT IN ('cancelled','draft') AND deleted_at IS NULL", [ctx.main, today()])
  )[0];
  assert.equal(mainVat.json.data.branches[0].outputVat, Number(direct.vat));

  const denied = await api("GET", `/api/v1/reports/vat?${range}&scope=all`, { token: ctx.mainAdmin.token });
  assert.equal(denied.status, 403);

  const all = await api("GET", `/api/v1/reports/vat?${range}&scope=all`, { token: ctx.superAdmin.token });
  assert.equal(all.status, 200);
  const branchIds = all.json.data.branches.map((b) => b.branch.id);
  assert.ok(branchIds.includes(ctx.main) && branchIds.includes(ctx.women));
  const summed = Math.round(all.json.data.branches.reduce((s, b) => s + b.outputVat, 0) * 100) / 100;
  assert.equal(all.json.data.consolidated.outputVat, summed);
});

test("dashboard summary no longer leaks other branches", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const denied = await api("GET", "/api/v1/reports/summary?scope=all", { token: ctx.womenAdmin.token });
  assert.equal(denied.status, 403);
  const spoof = await api("GET", `/api/v1/reports/revenue?branchId=${ctx.main}`, { token: ctx.womenAdmin.token });
  assert.equal(spoof.status, 200);
  const womenOnly = await query(
    "SELECT COALESCE(SUM(amount),0) AS revenue FROM payments WHERE status='completed' AND branch_id = ? AND completed_at >= UTC_DATE() - INTERVAL 12 MONTH",
    [ctx.women]
  );
  const reported = spoof.json.data.reduce((s, r) => s + Number(r.revenue), 0);
  assert.equal(Math.round(reported * 100), Math.round(Number(womenOnly[0].revenue) * 100));
});

test("Zakat worksheet: inputs save per branch, consolidated sums them, export is logged", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const { hijriYear } = require("../src/utils/hijri");
  ctx.zakatYear = hijriYear();
  const save = (admin, cash) =>
    api("PUT", "/api/v1/reports/zakat", {
      token: admin.token,
      body: { hijriYear: ctx.zakatYear, inputs: { cash_on_hand: cash, current_liabilities: 100 }, otherInputs: [{ label: "Deposits", amount: 5 }], notes: "test" }
    });
  assert.equal((await save(ctx.mainAdmin, 1000)).status, 200);
  assert.equal((await save(ctx.womenAdmin, 2500.5)).status, 200);

  const mine = await api("GET", `/api/v1/reports/zakat?hijriYear=${ctx.zakatYear}`, { token: ctx.womenAdmin.token });
  assert.equal(mine.json.data.branches[0].inputs.cash_on_hand, 2500.5);
  assert.equal(mine.json.data.branches[0].otherInputs[0].label, "Deposits");
  assert.ok(mine.json.data.branches[0].system.revenueGross >= 460);

  const all = await api("GET", `/api/v1/reports/zakat?hijriYear=${ctx.zakatYear}&scope=all`, { token: ctx.superAdmin.token });
  const expected = all.json.data.branches.reduce((s, b) => s + (b.inputs.cash_on_hand || 0), 0);
  assert.equal(all.json.data.consolidated.inputs.cash_on_hand, Math.round(expected * 100) / 100);

  const xlsx = await api("GET", `/api/v1/reports/zakat?hijriYear=${ctx.zakatYear}&format=xlsx&lang=ar`, { token: ctx.womenAdmin.token, raw: true });
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.headers.get("content-type"), /spreadsheetml/);
  const logged = await query("SELECT COUNT(*) AS n FROM logs WHERE action = 'reports.export.zakat' AND actor_id = ?", [ctx.womenAdmin.id]);
  assert.ok(logged[0].n >= 1);
});

test("annual revenue and churn/renewal count the seeded events", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const year = new Date().getUTCFullYear();
  const annual = await api("GET", `/api/v1/reports/revenue-annual?year=${year}`, { token: ctx.womenAdmin.token });
  const month = annual.json.data.months[new Date().getUTCMonth()];
  assert.ok(month.revenue >= 460);
  assert.ok(annual.json.data.byMethod.some((m) => m.method === "cash"));

  // A lapsed member (churn) and a renewal payment for the women's branch.
  const userRepository = require("../src/repositories/userRepository");
  const lapsed = await userRepository.createUser({ branchId: ctx.women, fullName: "Reports lapsed", email: `reports.lapsed.${RUN}@test.local`, phone: nextPhone(), password: "MemberUser@123" });
  ctx.userIds.push(lapsed.id);
  await query(
    "INSERT INTO memberships (branch_id, user_id, plan_id, status, start_date, end_date) VALUES (?, ?, ?, 'expired', UTC_DATE() - INTERVAL 40 DAY, UTC_DATE() - INTERVAL 10 DAY)",
    [ctx.women, lapsed.id, ctx.womenPlan]
  );
  const paymentService = require("../src/services/paymentService");
  await paymentService.recordManualPayment(ctx.womenAdmin.id, ctx.women, { userId: ctx.womenSale.user.id, planId: ctx.womenPlan, method: "card", idempotencyKey: crypto.randomUUID() });

  const from = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);
  const churn = await api("GET", `/api/v1/reports/churn?from=${from}&to=${today()}`, { token: ctx.womenAdmin.token });
  assert.equal(churn.status, 200);
  assert.ok(churn.json.data.branches[0].churned >= 1);
  assert.ok(churn.json.data.branches[0].renewed >= 1);
  assert.ok(churn.json.data.branches[0].renewalRate > 0 && churn.json.data.branches[0].renewalRate < 100);
});
