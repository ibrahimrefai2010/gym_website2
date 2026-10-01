// Moyasar online payments (Part 2 §2.1) -- end-to-end against the real DB and
// the real app, with a local mock of the Moyasar REST API (MOYASAR_API_BASE)
// standing in for api.moyasar.com. The mock implements exactly the subset
// the app uses: POST /invoices, GET /invoices/:id (Basic auth, halalas).
//
// Covers: checkout creates a pending attempt + Moyasar invoice with the
// right amount/auth; redirect status stays pending until paid; a signed
// payment_paid webhook completes payment + activates membership + issues a
// VAT-inclusive ZATCA invoice in one go; duplicate / replayed / concurrent
// deliveries never double-apply; a bad secret is rejected; renewal extends
// the active membership; a failed payment closes the attempt, cancels the
// pending membership and raises a task; an amount mismatch never activates;
// a plan from the other branch is a 404; the redirect origin is allowlisted.

process.env.MOYASAR_SECRET_KEY = "sk_test_mock_secret";
process.env.MOYASAR_WEBHOOK_SECRET = "whsec_mock_token";
process.env.MOYASAR_MODE = "test";

const http = require("http");
const crypto = require("crypto");
const test = require("node:test");
const assert = require("node:assert/strict");
const cron = require("node-cron");

// The mock must be listening (and MOYASAR_API_BASE set) before env.js loads.
const mock = { invoices: new Map(), lastAuth: null, lastCreateBody: null };
const mockServer = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    mock.lastAuth = req.headers.authorization;
    const send = (status, payload) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.method === "POST" && req.url === "/invoices") {
      const input = JSON.parse(body || "{}");
      mock.lastCreateBody = input;
      const id = crypto.randomUUID();
      const invoice = {
        id,
        status: "initiated",
        amount: input.amount,
        currency: input.currency,
        description: input.description,
        url: `https://checkout.mock/invoices/${id}`,
        metadata: input.metadata,
        payments: []
      };
      mock.invoices.set(id, invoice);
      return send(201, invoice);
    }
    const match = req.url.match(/^\/invoices\/([\w-]+)$/);
    if (req.method === "GET" && match) {
      const invoice = mock.invoices.get(match[1]);
      return invoice ? send(200, invoice) : send(404, { type: "invalid_request_error", message: "Not found" });
    }
    return send(404, { message: "unknown route" });
  });
});

let app;
let query;
let getPool;
let hasDatabaseConfig;
let paymentService;
let server;
let baseUrl;
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const ctx = { ready: false, userIds: [], planIds: [], invoiceIds: [], paymentIds: [] };
let phoneSeq = 0;

function nextPhone() {
  phoneSeq += 1;
  return `058${String((Date.now() + phoneSeq) % 10000000).padStart(7, "0")}`;
}

async function api(method, path, { token, body, raw, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined
  });
  let json = null;
  try {
    json = await res.json();
  } catch (_error) {
    json = null;
  }
  return { status: res.status, json };
}

function markPaid(invoiceId, { amount } = {}) {
  const invoice = mock.invoices.get(invoiceId);
  invoice.status = "paid";
  if (amount !== undefined) invoice.amount = amount;
  invoice.payments.push({ id: crypto.randomUUID(), status: "paid", amount: invoice.amount, source: { type: "creditcard", company: "mada" } });
}

function markFailed(invoiceId) {
  const invoice = mock.invoices.get(invoiceId);
  invoice.status = "failed";
  invoice.payments.push({ id: crypto.randomUUID(), status: "failed", amount: invoice.amount, source: { type: "creditcard", message: "INSUFFICIENT FUNDS" } });
}

function webhook(invoiceId, { type = "payment_paid", secret = process.env.MOYASAR_WEBHOOK_SECRET, eventId = crypto.randomUUID() } = {}) {
  return api("POST", "/api/v1/payments/webhook/moyasar", {
    raw: JSON.stringify({
      id: eventId,
      type,
      created_at: new Date().toISOString(),
      secret_token: secret,
      account_name: "mock",
      live: false,
      data: { id: crypto.randomUUID(), status: type === "payment_paid" ? "paid" : "failed", invoice_id: invoiceId, amount: 1 }
    })
  });
}

async function createMember(branchId, label) {
  const userRepository = require("../src/repositories/userRepository");
  const password = "MemberUser@123";
  const email = `moyasar.${label}.${RUN}@test.local`;
  const user = await userRepository.createUser({ branchId, fullName: `Moyasar ${label}`, email, phone: nextPhone(), password });
  ctx.userIds.push(user.id);
  const branchCode = branchId === ctx.mainBranchId ? "main" : "women";
  const login = await api("POST", "/api/v1/auth/login", { body: { identifier: email, password }, headers: { "X-Branch": branchCode } });
  assert.equal(login.status, 200, "setup: member login");
  return { id: user.id, token: login.json.data.accessToken };
}

async function paymentRow(id) {
  const rows = await query("SELECT * FROM payments WHERE id = ?", [id]);
  return rows[0];
}

async function startCheckout(member, planId) {
  const res = await api("POST", "/api/v1/payments/checkout", { token: member.token, body: { planId } });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  ctx.paymentIds.push(res.json.data.paymentId);
  const row = await paymentRow(res.json.data.paymentId);
  return { ...res.json.data, invoiceId: row.provider_reference, row };
}

test.before(async () => {
  await new Promise((resolve) => mockServer.listen(0, resolve));
  process.env.MOYASAR_API_BASE = `http://127.0.0.1:${mockServer.address().port}`;

  ({ hasDatabaseConfig, query, getPool } = require("../src/config/database"));
  if (!hasDatabaseConfig()) return;
  app = require("../src/app");
  paymentService = require("../src/services/paymentService");
  const planRepository = require("../src/repositories/planRepository");

  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const branches = await query("SELECT id, code FROM branches WHERE code IN ('main','women')");
  const main = branches.find((row) => row.code === "main");
  const women = branches.find((row) => row.code === "women");
  if (!main || !women) return;
  ctx.mainBranchId = main.id;
  ctx.womenBranchId = women.id;

  for (const [key, branchId, price] of [["mainPlan", main.id, 300], ["womenPlan", women.id, 250]]) {
    const plan = await planRepository.savePlan({
      nameEn: `Moyasar Plan ${RUN}`,
      nameAr: "خطة اختبار الدفع",
      descriptionEn: "Test",
      descriptionAr: "اختبار",
      durationDays: 30,
      price,
      branchId
    });
    ctx[key] = plan.id;
    ctx.planIds.push(plan.id);
  }
  ctx.ready = true;
});

test.after(async () => {
  mockServer.close();
  if (!hasDatabaseConfig || !hasDatabaseConfig()) return;
  const tryDelete = async (sql, params) => {
    try {
      if (params.length) await query(sql, params);
    } catch (error) {
      console.error("[moyasar.test.js cleanup]", error.code || error.message);
    }
  };
  const list = (ids) => ids.map(() => "?").join(",");
  const users = ctx.userIds;
  if (users.length) {
    const invoices = await query(`SELECT id FROM invoices WHERE user_id IN (${list(users)})`, users);
    const invoiceIds = invoices.map((row) => row.id);
    const payments = await query(`SELECT id FROM payments WHERE user_id IN (${list(users)})`, users);
    const paymentIds = payments.map((row) => row.id);
    await tryDelete(`DELETE FROM tasks WHERE linked_resource_type = 'payment' AND linked_resource_id IN (${list(paymentIds)})`, paymentIds);
    await tryDelete(`UPDATE payments SET invoice_id = NULL WHERE id IN (${list(paymentIds)})`, paymentIds);
    await tryDelete(`DELETE FROM invoice_items WHERE invoice_id IN (${list(invoiceIds)})`, invoiceIds);
    await tryDelete(`DELETE FROM invoices WHERE id IN (${list(invoiceIds)})`, invoiceIds);
    await tryDelete(`DELETE FROM payments WHERE user_id IN (${list(users)})`, users);
    await tryDelete(`DELETE FROM memberships WHERE user_id IN (${list(users)})`, users);
    await tryDelete(`DELETE FROM notifications WHERE user_id IN (${list(users)})`, users);
    await tryDelete(`DELETE FROM refresh_tokens WHERE user_id IN (${list(users)})`, users);
    await tryDelete(`DELETE FROM users WHERE id IN (${list(users)})`, users);
  }
  await tryDelete(`DELETE FROM plans WHERE id IN (${list(ctx.planIds)})`, ctx.planIds);
  if (server) await new Promise((resolve) => server.close(resolve));
  const pool = getPool();
  if (pool) await pool.end();
  for (const [, task] of cron.getTasks()) {
    task.stop();
    task.destroy();
  }
});

test("new purchase: checkout -> pending -> signed webhook completes payment, activates membership, issues VAT-inclusive invoice", async (t) => {
  if (!ctx.ready) return t.skip("no DB / branches");
  const member = await createMember(ctx.mainBranchId, "new");
  const checkout = await startCheckout(member, ctx.mainPlan);

  assert.match(checkout.checkoutUrl, /^https:\/\/checkout\.mock\/invoices\//);
  assert.equal(mock.lastCreateBody.amount, 30000, "amount in halalas");
  assert.equal(mock.lastCreateBody.currency, "SAR");
  assert.match(mock.lastCreateBody.success_url, new RegExp(`/user\\.html\\?payment=${checkout.paymentId}$`));
  assert.equal(mock.lastAuth, `Basic ${Buffer.from("sk_test_mock_secret:").toString("base64")}`);
  assert.equal(checkout.row.status, "pending");
  assert.equal(checkout.row.purpose, "new");
  assert.equal(Number(checkout.row.branch_id), ctx.mainBranchId);

  const before = await api("GET", `/api/v1/payments/${checkout.paymentId}/status`, { token: member.token });
  assert.equal(before.json.data.status, "pending");

  markPaid(checkout.invoiceId);
  const hook = await webhook(checkout.invoiceId);
  assert.equal(hook.status, 200);
  assert.equal(hook.json.data.status, "completed");

  const row = await paymentRow(checkout.paymentId);
  assert.equal(row.status, "completed");
  assert.ok(row.invoice_id, "invoice linked");
  const membership = (await query("SELECT status, end_date FROM memberships WHERE id = ?", [row.membership_id]))[0];
  assert.equal(membership.status, "active");

  const invoice = (await query("SELECT * FROM invoices WHERE id = ?", [row.invoice_id]))[0];
  assert.equal(Number(invoice.total), 300);
  assert.equal(Number(invoice.tax_total), 39.13);
  assert.equal(Number(invoice.subtotal), 260.87);
  assert.equal(invoice.status, "paid");
  assert.equal(Number(invoice.branch_id), ctx.mainBranchId);
  assert.match(invoice.invoice_number, /^INV-M-\d{4}-\d{6}$/);
  assert.ok(invoice.zatca_qr);

  const after = await api("GET", `/api/v1/payments/${checkout.paymentId}/status`, { token: member.token });
  assert.equal(after.json.data.status, "completed");
  assert.equal(after.json.data.invoiceNumber, invoice.invoice_number);
});

test("duplicate, replayed and concurrent deliveries never double-apply", async (t) => {
  if (!ctx.ready) return t.skip("no DB / branches");
  const member = await createMember(ctx.mainBranchId, "dupe");
  const checkout = await startCheckout(member, ctx.mainPlan);
  markPaid(checkout.invoiceId);

  const eventId = crypto.randomUUID();
  const results = await Promise.all([
    webhook(checkout.invoiceId, { eventId }),
    webhook(checkout.invoiceId, { eventId }),
    webhook(checkout.invoiceId),
    api("GET", `/api/v1/payments/${checkout.paymentId}/status`, { token: member.token }),
    paymentService.reconcileMoyasarPayments()
  ]);
  assert.ok(results.slice(0, 3).every((res) => res.status === 200));

  const invoices = await query("SELECT id FROM invoices WHERE user_id = ?", [member.id]);
  assert.equal(invoices.length, 1, "exactly one invoice");
  const memberships = await query("SELECT status, end_date FROM memberships WHERE user_id = ?", [member.id]);
  assert.equal(memberships.filter((row) => row.status === "active").length, 1);
  const endDate = memberships[0].end_date;

  const replay = await webhook(checkout.invoiceId, { eventId });
  assert.equal(replay.json.data.duplicate, true);
  const again = (await query("SELECT end_date FROM memberships WHERE user_id = ?", [member.id]))[0];
  assert.equal(String(again.end_date), String(endDate), "membership not extended twice");
});

test("webhook with a wrong secret is rejected and changes nothing", async (t) => {
  if (!ctx.ready) return t.skip("no DB / branches");
  const member = await createMember(ctx.mainBranchId, "badsecret");
  const checkout = await startCheckout(member, ctx.mainPlan);
  markPaid(checkout.invoiceId);
  const hook = await webhook(checkout.invoiceId, { secret: "nope" });
  assert.equal(hook.status, 401);
  assert.equal((await paymentRow(checkout.paymentId)).status, "pending");
});

test("renewal extends the active membership by the plan duration", async (t) => {
  if (!ctx.ready) return t.skip("no DB / branches");
  const member = await createMember(ctx.mainBranchId, "renew");
  const first = await startCheckout(member, ctx.mainPlan);
  markPaid(first.invoiceId);
  await webhook(first.invoiceId);
  const original = (await query("SELECT id, end_date FROM memberships WHERE user_id = ? AND status = 'active'", [member.id]))[0];

  const renewal = await startCheckout(member, ctx.mainPlan);
  assert.equal(renewal.row.purpose, "renewal");
  assert.equal(renewal.row.membership_id, original.id);
  markPaid(renewal.invoiceId);
  await webhook(renewal.invoiceId);

  const extended = (await query("SELECT end_date FROM memberships WHERE id = ?", [original.id]))[0];
  const diffDays = Math.round((new Date(extended.end_date) - new Date(original.end_date)) / 86400000);
  assert.equal(diffDays, 30);
  const invoices = await query("SELECT id FROM invoices WHERE user_id = ?", [member.id]);
  assert.equal(invoices.length, 2);
});

test("failed payment closes the attempt, cancels the pending membership and raises a task", async (t) => {
  if (!ctx.ready) return t.skip("no DB / branches");
  const member = await createMember(ctx.womenBranchId, "failed");
  const checkout = await startCheckout(member, ctx.womenPlan);
  markFailed(checkout.invoiceId);
  const hook = await webhook(checkout.invoiceId, { type: "payment_failed" });
  assert.equal(hook.json.data.status, "failed");

  const row = await paymentRow(checkout.paymentId);
  assert.equal(row.status, "failed");
  assert.equal(row.failure_reason, "INSUFFICIENT FUNDS");
  assert.equal(row.invoice_id, null);
  const membership = (await query("SELECT status FROM memberships WHERE id = ?", [row.membership_id]))[0];
  assert.equal(membership.status, "cancelled");
  const tasks = await query("SELECT branch_id FROM tasks WHERE linked_resource_type = 'payment' AND linked_resource_id = ?", [row.id]);
  assert.equal(tasks.length, 1);
  assert.equal(Number(tasks[0].branch_id), ctx.womenBranchId);
  assert.equal((await query("SELECT COUNT(*) AS n FROM invoices WHERE user_id = ?", [member.id]))[0].n, 0);
});

test("a paid amount that does not match is never applied", async (t) => {
  if (!ctx.ready) return t.skip("no DB / branches");
  const member = await createMember(ctx.mainBranchId, "mismatch");
  const checkout = await startCheckout(member, ctx.mainPlan);
  markPaid(checkout.invoiceId, { amount: 100 });
  await webhook(checkout.invoiceId);
  const row = await paymentRow(checkout.paymentId);
  assert.equal(row.status, "failed");
  assert.equal(row.failure_reason, "amount_mismatch");
  const active = await query("SELECT id FROM memberships WHERE user_id = ? AND status = 'active'", [member.id]);
  assert.equal(active.length, 0);
});

test("a plan from the other branch is a 404 and a second click reuses the open checkout", async (t) => {
  if (!ctx.ready) return t.skip("no DB / branches");
  const member = await createMember(ctx.mainBranchId, "crossplan");
  const cross = await api("POST", "/api/v1/payments/checkout", { token: member.token, body: { planId: ctx.womenPlan } });
  assert.equal(cross.status, 404);

  const first = await startCheckout(member, ctx.mainPlan);
  const second = await api("POST", "/api/v1/payments/checkout", { token: member.token, body: { planId: ctx.mainPlan } });
  assert.equal(second.json.data.paymentId, first.paymentId);
  assert.equal(second.json.data.reused, true);

  const other = await createMember(ctx.mainBranchId, "snoop");
  const snoop = await api("GET", `/api/v1/payments/${first.paymentId}/status`, { token: other.token });
  assert.equal(snoop.status, 404, "another member cannot read this payment");
});

test("return origin only honours allowlisted origins", async (t) => {
  if (!ctx.ready) return t.skip("no DB / branches");
  const { env } = require("../src/config/env");
  const allowed = String(env.corsOrigin).split(",")[0].trim();
  assert.equal(paymentService.returnOrigin(allowed), allowed.replace(/\/$/, ""));
  assert.equal(paymentService.returnOrigin("https://evil.example"), String(env.baseUrl).replace(/\/$/, ""));
});
