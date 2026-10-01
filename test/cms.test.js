// Content management (Part 2 §2.0.8) -- real app + real DB.
//
// Covers: branch contact/social/WhatsApp settings reach only that branch's
// public bootstrap (bad links are rejected); FAQs are branch-scoped or
// shared, only cross-branch admins can create/edit shared ones, another
// branch's FAQ is a 404; new slides belong to the admin's branch (they used
// to be global), another branch's slide cannot be edited, scheduled slides
// stay hidden until their start; reordering rejects other-branch ids; plan
// features round-trip; a plan with active members cannot be deleted.

process.env.RATE_LIMIT_ADMIN_LOGIN = "50";

const test = require("node:test");
const assert = require("node:assert/strict");
const cron = require("node-cron");
const { hasDatabaseConfig, query, getPool } = require("../src/config/database");

const noDb = !hasDatabaseConfig();
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const ctx = { ready: false, adminIds: [], roleKeys: [], planIds: [], userIds: [], contactBackup: [] };
let server;
let baseUrl;

async function api(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function createAdmin(branchId, permissions, role = "staff") {
  const { hashPassword } = require("../src/utils/hash");
  const email = `cms.${role}.${branchId}.${ctx.adminIds.length}.${RUN}@test.local`;
  const result = await query(
    "INSERT INTO admin_users (branch_id, full_name, email, password_hash, role, status) VALUES (?, 'CMS Test', ?, ?, ?, 'active')",
    [branchId, email, await hashPassword("CmsAdmin@1234"), role]
  );
  ctx.adminIds.push(result.insertId);
  if (permissions.length) {
    const roleKey = `test_cms_${RUN}_${result.insertId}`;
    const r = await query("INSERT INTO roles (key_name, display_name, is_system, is_active) VALUES (?, 'CMS Test', 0, 1)", [roleKey]);
    for (const key of permissions) {
      const perm = await query("SELECT id FROM permissions WHERE key_name = ? LIMIT 1", [key]);
      if (perm[0]) await query("INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [r.insertId, perm[0].id]);
    }
    await query("INSERT INTO admin_user_roles (admin_user_id, role_id) VALUES (?, ?)", [result.insertId, r.insertId]);
    ctx.roleKeys.push(roleKey);
  }
  const login = await api("POST", "/api/v1/admin/auth/login", { body: { identifier: email, password: "CmsAdmin@1234" } });
  assert.equal(login.status, 200);
  return { id: result.insertId, token: login.json.data.accessToken };
}

const bootstrap = async (branch) => (await api("GET", "/api/v1/public/bootstrap", { headers: { "X-Branch": branch } })).json.data;

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
  ctx.contactBackup = await query("SELECT branch_id, key_name, value FROM settings WHERE branch_id = ? AND key_name IN ('contact_email','instagram_url','whatsapp_message_en')", [ctx.women]);
  const perms = ["dashboard:read", "settings:write", "cms:manage", "plans:write"];
  ctx.mainAdmin = await createAdmin(ctx.main, perms);
  ctx.womenAdmin = await createAdmin(ctx.women, perms);
  ctx.superAdmin = await createAdmin(ctx.main, [], "super_admin");
  ctx.ready = true;
});

test.after(async () => {
  if (noDb) return;
  const run = async (sql, params) => {
    try {
      if (params.length) await query(sql, params);
    } catch (error) {
      console.error("[cms.test.js cleanup]", error.code || error.message);
    }
  };
  const list = (ids) => ids.map(() => "?").join(",");
  for (const row of ctx.contactBackup) await run("UPDATE settings SET value = ? WHERE branch_id = ? AND key_name = ?", [row.value, row.branch_id, row.key_name]);
  await run("DELETE FROM faqs WHERE question_en LIKE ?", [`%${RUN}%`]);
  await run("DELETE FROM slider_images WHERE title_en LIKE ?", [`%${RUN}%`]);
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

test("contact settings are per branch and validated", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const bad = await api("PUT", "/api/v1/cms/contact", { token: ctx.womenAdmin.token, body: { values: { instagram_url: "javascript:alert(1)" } } });
  assert.equal(bad.status, 422);
  const saved = await api("PUT", "/api/v1/cms/contact", {
    token: ctx.womenAdmin.token,
    body: { values: { contact_email: `women.${RUN}@gym.test`, instagram_url: `https://instagram.com/w${RUN}`, whatsapp_message_en: `Hi women ${RUN}` } }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const women = await bootstrap("women");
  assert.equal(women.contact.email, `women.${RUN}@gym.test`);
  assert.equal(women.contact.social.instagram, `https://instagram.com/w${RUN}`);
  assert.equal(women.contact.whatsappMessage.en, `Hi women ${RUN}`);
  const main = await bootstrap("main");
  assert.notEqual(main.contact.email, `women.${RUN}@gym.test`);
});

test("FAQs: branch or shared, shared only for cross-branch admins, other branch is a 404", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const body = (label, extra = {}) => ({ questionEn: `Q ${label} ${RUN}`, questionAr: "سؤال", answerEn: "A", answerAr: "ج", ...extra });
  const women = await api("POST", "/api/v1/cms/faqs", { token: ctx.womenAdmin.token, body: body("women") });
  assert.equal(women.status, 201);
  assert.equal(women.json.data.branchId, ctx.women);
  assert.equal((await api("POST", "/api/v1/cms/faqs", { token: ctx.womenAdmin.token, body: body("shared-denied", { shared: true }) })).status, 403);
  const shared = await api("POST", "/api/v1/cms/faqs", { token: ctx.superAdmin.token, body: body("shared", { shared: true }) });
  assert.equal(shared.status, 201);
  assert.equal(shared.json.data.shared, true);

  const womenQs = (await bootstrap("women")).faqs.map((f) => f.question.en);
  const mainQs = (await bootstrap("main")).faqs.map((f) => f.question.en);
  assert.ok(womenQs.includes(`Q women ${RUN}`) && womenQs.includes(`Q shared ${RUN}`));
  assert.ok(!mainQs.includes(`Q women ${RUN}`) && mainQs.includes(`Q shared ${RUN}`));

  assert.equal((await api("POST", "/api/v1/cms/faqs", { token: ctx.mainAdmin.token, body: body("hijack", { id: women.json.data.id }) })).status, 404);
  assert.equal((await api("DELETE", `/api/v1/cms/faqs/${shared.json.data.id}`, { token: ctx.womenAdmin.token })).status, 403);
  assert.equal((await api("DELETE", `/api/v1/cms/faqs/${women.json.data.id}`, { token: ctx.womenAdmin.token })).status, 200);
});

test("slides belong to the admin's branch, cannot be hijacked, and respect their schedule", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const slide = (label, extra = {}) => ({ imageUrl: "/assets/images/hero-gym.webp", titleEn: `Slide ${label} ${RUN}`, titleAr: "شريحة", bodyEn: "B", bodyAr: "ن", isActive: true, ...extra });
  const created = await api("POST", "/api/v1/admin/slides", { token: ctx.womenAdmin.token, body: slide("women", { branchId: ctx.main }) });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const row = (await query("SELECT branch_id FROM slider_images WHERE id = ?", [created.json.data.id]))[0];
  assert.equal(Number(row.branch_id), ctx.women, "slide gets the admin's branch, not NULL / a spoofed one");
  const hijack = await api("POST", "/api/v1/admin/slides", { token: ctx.mainAdmin.token, body: slide("hijack", { id: created.json.data.id }) });
  assert.equal(hijack.status, 404);

  const future = await api("POST", "/api/v1/admin/slides", { token: ctx.womenAdmin.token, body: slide("future", { startsAt: "2099-01-01" }) });
  assert.equal(future.status, 201);
  const titles = (await bootstrap("women")).slides.map((s) => s.title.en);
  assert.ok(titles.includes(`Slide women ${RUN}`));
  assert.ok(!titles.includes(`Slide future ${RUN}`), "scheduled slide hidden until start");
  assert.ok(!(await bootstrap("main")).slides.map((s) => s.title.en).includes(`Slide women ${RUN}`));
});

test("plans: features round-trip, reorder is branch-checked, in-use plans cannot be deleted", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const planRepository = require("../src/repositories/planRepository");
  const mk = async (branchId, label) => {
    const plan = await planRepository.savePlan({
      nameEn: `CMS ${label} ${RUN}`, nameAr: "باقة", descriptionEn: "D", descriptionAr: "و", durationDays: 30, price: 99, branchId,
      featuresEn: "Pool access\nTowel service", featuresAr: "دخول المسبح\nمناشف"
    });
    ctx.planIds.push(plan.id);
    return plan;
  };
  const a = await mk(ctx.women, "a");
  const b = await mk(ctx.women, "b");
  const other = await mk(ctx.main, "other");
  assert.deepEqual(a.features.en, ["Pool access", "Towel service"]);
  assert.deepEqual(a.features.ar, ["دخول المسبح", "مناشف"]);

  const ok = await api("PUT", "/api/v1/cms/order/plans", { token: ctx.womenAdmin.token, body: { ids: [b.id, a.id] } });
  assert.equal(ok.status, 200);
  const orders = await query("SELECT id, sort_order FROM plans WHERE id IN (?, ?) ORDER BY sort_order", [a.id, b.id]);
  assert.equal(orders[0].id, b.id);
  assert.equal((await api("PUT", "/api/v1/cms/order/plans", { token: ctx.womenAdmin.token, body: { ids: [a.id, other.id] } })).status, 404);

  const userRepository = require("../src/repositories/userRepository");
  const user = await userRepository.createUser({ branchId: ctx.women, fullName: "CMS member", email: `cms.member.${RUN}@test.local`, phone: `059${String(Date.now() % 10000000).padStart(7, "0")}`, password: "MemberUser@123" });
  ctx.userIds.push(user.id);
  await query("INSERT INTO memberships (branch_id, user_id, plan_id, status, start_date, end_date) VALUES (?, ?, ?, 'active', UTC_DATE(), UTC_DATE() + INTERVAL 10 DAY)", [ctx.women, user.id, a.id]);
  const del = await api("DELETE", `/api/v1/plans/${a.id}`, { token: ctx.womenAdmin.token });
  assert.equal(del.status, 409, JSON.stringify(del.json));
  assert.equal((await api("DELETE", `/api/v1/plans/${b.id}`, { token: ctx.womenAdmin.token })).status, 200);
});
