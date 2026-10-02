// AI assistant (Part 2 §2.3) -- real app + real DB, with a local mock of the
// Gemini generateContent API (GEMINI_API_BASE) so no real model is called.
//
// Covers: the tool loop runs the requested read-only tools and feeds back
// results that only contain the admin's own branch (and no phone numbers);
// tools are filtered by permission (no VAT tool without tax_reports:read);
// a scoped admin cannot get the consolidated scope; a refusal is handled;
// every question is audit-logged; the feature flag turns it off; insights.

process.env.AI_ASSISTANT_ENABLED = "true";
process.env.GEMINI_API_KEY = "gemini-test-mock";

const http = require("http");
const test = require("node:test");
const assert = require("node:assert/strict");
const cron = require("node-cron");

const mock = { requests: [], script: [] };
const mockServer = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const parsed = JSON.parse(body || "{}");
    mock.requests.push({ url: req.url, headers: req.headers, body: parsed });
    const next = mock.script.shift() || { candidates: [{ content: { role: "model", parts: [{ text: "Done." }] }, finishReason: "STOP" }] };
    res.writeHead(next.httpStatus || 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(next.httpStatus ? { error: { message: next.message || "mock error" } } : { modelVersion: "gemini-mock", ...next }));
  });
});
const modelTurn = (...parts) => ({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }] });

let query;
let getPool;
let hasDatabaseConfig;
let server;
let baseUrl;
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const ctx = { ready: false, userIds: [], planIds: [], adminIds: [], roleKeys: [] };
let phoneSeq = 0;
const nextPhone = () => `057${String((Date.now() + ++phoneSeq) % 10000000).padStart(7, "0")}`;

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function createAdmin(branchId, permissions) {
  const { hashPassword } = require("../src/utils/hash");
  const email = `ai.${branchId}.${permissions.length}.${RUN}@test.local`;
  const result = await query(
    "INSERT INTO admin_users (branch_id, full_name, email, password_hash, role, status) VALUES (?, 'AI Test', ?, ?, 'staff', 'active')",
    [branchId, email, await hashPassword("AiAdmin@12345")]
  );
  const roleKey = `test_ai_${RUN}_${result.insertId}`;
  const role = await query("INSERT INTO roles (key_name, display_name, is_system, is_active) VALUES (?, 'AI Test', 0, 1)", [roleKey]);
  for (const key of permissions) {
    const perm = await query("SELECT id FROM permissions WHERE key_name = ? LIMIT 1", [key]);
    if (perm[0]) await query("INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [role.insertId, perm[0].id]);
  }
  await query("INSERT INTO admin_user_roles (admin_user_id, role_id) VALUES (?, ?)", [result.insertId, role.insertId]);
  ctx.adminIds.push(result.insertId);
  ctx.roleKeys.push(roleKey);
  const login = await api("POST", "/api/v1/admin/auth/login", { body: { identifier: email, password: "AiAdmin@12345" } });
  assert.equal(login.status, 200);
  return { id: result.insertId, token: login.json.data.accessToken };
}

async function expiringMember(branchId, label) {
  const userRepository = require("../src/repositories/userRepository");
  const user = await userRepository.createUser({ branchId, fullName: `AI ${label} ${RUN}`, email: `ai.${label}.${RUN}@test.local`, phone: nextPhone(), password: "MemberUser@123" });
  ctx.userIds.push(user.id);
  const planId = branchId === ctx.main ? ctx.mainPlan : ctx.womenPlan;
  await query(
    "INSERT INTO memberships (branch_id, user_id, plan_id, status, start_date, end_date) VALUES (?, ?, ?, 'active', UTC_DATE() - INTERVAL 20 DAY, UTC_DATE() + INTERVAL 3 DAY)",
    [branchId, user.id, planId]
  );
  return { ...user, phone: (await query("SELECT phone FROM users WHERE id = ?", [user.id]))[0].phone };
}

test.before(async () => {
  await new Promise((resolve) => mockServer.listen(0, resolve));
  process.env.GEMINI_API_BASE = `http://127.0.0.1:${mockServer.address().port}/v1beta`;
  ({ query, getPool, hasDatabaseConfig } = require("../src/config/database"));
  if (!hasDatabaseConfig()) return;
  const app = require("../src/app");
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const branches = await query("SELECT id, code FROM branches WHERE code IN ('main','women')");
  ctx.main = branches.find((r) => r.code === "main")?.id;
  ctx.women = branches.find((r) => r.code === "women")?.id;
  if (!ctx.main || !ctx.women) return;
  const planRepository = require("../src/repositories/planRepository");
  for (const [key, branchId] of [["mainPlan", ctx.main], ["womenPlan", ctx.women]]) {
    const plan = await planRepository.savePlan({ nameEn: `AI Plan ${RUN}`, nameAr: "خطة", descriptionEn: "T", descriptionAr: "ت", durationDays: 30, price: 100, branchId });
    ctx[key] = plan.id;
    ctx.planIds.push(plan.id);
  }
  ctx.mainAdmin = await createAdmin(ctx.main, ["dashboard:read", "ai:manage"]);
  ctx.mainMember = await expiringMember(ctx.main, "main");
  ctx.womenMember = await expiringMember(ctx.women, "women");
  ctx.ready = true;
});

test.after(async () => {
  mockServer.close();
  if (!hasDatabaseConfig || !hasDatabaseConfig()) return;
  const run = async (sql, params) => {
    try {
      if (params.length) await query(sql, params);
    } catch (error) {
      console.error("[aiAssistant.test.js cleanup]", error.code || error.message);
    }
  };
  const list = (ids) => ids.map(() => "?").join(",");
  await run(`DELETE FROM ai_logs WHERE admin_user_id IN (${list(ctx.adminIds)})`, ctx.adminIds);
  await run(`DELETE FROM memberships WHERE user_id IN (${list(ctx.userIds)})`, ctx.userIds);
  await run(`DELETE FROM users WHERE id IN (${list(ctx.userIds)})`, ctx.userIds);
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

test("tool loop: results stay inside the admin's branch, no contact details, permission-filtered tools", async (t) => {
  if (!ctx.ready) return t.skip("no DB");
  mock.requests = [];
  mock.script = [
    modelTurn(
      { text: "Checking." },
      { functionCall: { name: "list_expiring_memberships", args: { within_days: 7 } } },
      { functionCall: { name: "get_dashboard_kpis", args: {} } }
    ),
    modelTurn({ text: "Two members expire this week." })
  ];
  const res = await api("POST", "/api/v1/ai/assistant", { token: ctx.mainAdmin.token, body: { prompt: "Who expires this week?", branchId: ctx.women } });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.data.answer, "Two members expire this week.");
  assert.deepEqual(res.json.data.toolsUsed.sort(), ["get_dashboard_kpis", "list_expiring_memberships"]);

  const first = mock.requests[0].body;
  assert.match(mock.requests[0].url, /\/models\/gemini-2\.5-flash:generateContent$/);
  assert.equal(mock.requests[0].headers["x-goog-api-key"], "gemini-test-mock");
  const declarations = first.tools[0].functionDeclarations;
  const toolNames = declarations.map((tool) => tool.name);
  assert.ok(toolNames.includes("list_expiring_memberships"));
  assert.ok(!toolNames.includes("get_vat_summary"), "no tax_reports:read -> no VAT tool");
  assert.ok(!toolNames.includes("get_revenue"), "no reports:read -> no revenue tool");
  assert.ok(!JSON.stringify(declarations).includes("additionalProperties"), "schema is Gemini-compatible");
  assert.equal(declarations.find((tool) => tool.name === "get_dashboard_kpis").parameters, undefined, "empty-parameter tools omit parameters");
  assert.match(first.systemInstruction.parts[0].text, /Main Branch/);

  const second = mock.requests[1].body;
  const toolResults = second.contents[second.contents.length - 1].parts;
  const expiring = toolResults.find((r) => r.functionResponse.name === "list_expiring_memberships").functionResponse.response.result;
  const names = expiring.members.map((m) => m.name);
  assert.ok(names.includes(ctx.mainMember.full_name));
  assert.ok(!names.includes(ctx.womenMember.full_name), "spoofed branchId ignored");
  const raw = JSON.stringify(toolResults);
  assert.ok(!raw.includes(ctx.mainMember.phone), "no phone numbers sent to the model");

  const logged = await query("SELECT COUNT(*) AS n FROM logs WHERE action = 'ai.query' AND actor_id = ?", [ctx.mainAdmin.id]);
  assert.ok(logged[0].n >= 1);
  const aiLog = await query("SELECT prompt FROM ai_logs WHERE admin_user_id = ? ORDER BY id DESC LIMIT 1", [ctx.mainAdmin.id]);
  assert.equal(aiLog[0].prompt, "Who expires this week?");
});

test("consolidated scope is refused for a branch-scoped admin; refusals are handled", async (t) => {
  if (!ctx.ready) return t.skip("no DB");
  const denied = await api("POST", "/api/v1/ai/assistant?scope=all", { token: ctx.mainAdmin.token, body: { prompt: "All branches?" } });
  assert.equal(denied.status, 403);

  mock.script = [{ promptFeedback: { blockReason: "SAFETY" } }];
  const refused = await api("POST", "/api/v1/ai/assistant", { token: ctx.mainAdmin.token, body: { prompt: "something" } });
  assert.equal(refused.status, 200);
  assert.equal(refused.json.data.refused, true);
});

test("free-tier quota errors give a friendly message; thinking parts are not shown", async (t) => {
  if (!ctx.ready) return t.skip("no DB");
  mock.script = [{ httpStatus: 429, message: "quota exceeded" }];
  const limited = await api("POST", "/api/v1/ai/assistant", { token: ctx.mainAdmin.token, body: { prompt: "anything" } });
  assert.equal(limited.status, 503);
  assert.match(limited.json.message || limited.json.error?.message || JSON.stringify(limited.json), /free usage limit/);

  mock.script = [modelTurn({ text: "internal reasoning", thought: true }, { text: "Final answer." })];
  const ok = await api("POST", "/api/v1/ai/assistant", { token: ctx.mainAdmin.token, body: { prompt: "hello" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.answer, "Final answer.");
});

test("insights work and the feature flag switches the assistant off", async (t) => {
  if (!ctx.ready) return t.skip("no DB");
  const insights = await api("GET", "/api/v1/ai/insights", { token: ctx.mainAdmin.token });
  assert.equal(insights.status, 200);
  assert.ok(insights.json.data.items.some((item) => /expire/.test(item.en)));

  const { env } = require("../src/config/env");
  env.aiAssistantEnabled = false;
  try {
    const off = await api("POST", "/api/v1/ai/assistant", { token: ctx.mainAdmin.token, body: { prompt: "hi" } });
    assert.equal(off.status, 404);
    const status = await api("GET", "/api/v1/ai/status", { token: ctx.mainAdmin.token });
    assert.equal(status.json.data.enabled, false);
  } finally {
    env.aiAssistantEnabled = true;
  }
});
