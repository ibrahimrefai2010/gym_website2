// Staff management, audit log viewer and the admin bell feed (Part 2 §2.0.9).
//
// Covers: creating a staff account returns a one-time password and forces a
// change at first sign-in (the panel is blocked until then); only a
// super_admin can grant / touch super_admin; another branch's staff id is a
// 404 (incl. the existing role-assignment endpoint); nobody deactivates
// themselves; password reset revokes sessions; audit logs are branch-scoped,
// consolidated only for cross-branch admins, exportable; the bell feed shows
// a new lead as unread until the bell is opened.

// This file signs in more than the production admin-login limit allows.
process.env.RATE_LIMIT_ADMIN_LOGIN = "50";

const test = require("node:test");
const assert = require("node:assert/strict");
const cron = require("node-cron");
const { hasDatabaseConfig, query, getPool } = require("../src/config/database");

const noDb = !hasDatabaseConfig();
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const ctx = { ready: false, adminIds: [], roleKeys: [], messageIds: [] };
let server;
let baseUrl;

async function api(method, path, { token, body, raw = false, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (raw) return res;
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function login(email, password) {
  return api("POST", "/api/v1/admin/auth/login", { body: { identifier: email, password } });
}

async function createAdmin(branchId, permissions, role = "staff") {
  const { hashPassword } = require("../src/utils/hash");
  const email = `staffops.${role}.${branchId}.${ctx.adminIds.length}.${RUN}@test.local`;
  const result = await query(
    "INSERT INTO admin_users (branch_id, full_name, email, password_hash, role, status) VALUES (?, 'StaffOps Test', ?, ?, ?, 'active')",
    [branchId, email, await hashPassword("StaffOps@1234"), role]
  );
  ctx.adminIds.push(result.insertId);
  if (permissions.length) {
    const roleKey = `test_staffops_${RUN}_${result.insertId}`;
    const r = await query("INSERT INTO roles (key_name, display_name, is_system, is_active) VALUES (?, 'StaffOps Test', 0, 1)", [roleKey]);
    for (const key of permissions) {
      const perm = await query("SELECT id FROM permissions WHERE key_name = ? LIMIT 1", [key]);
      if (perm[0]) await query("INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [r.insertId, perm[0].id]);
    }
    await query("INSERT INTO admin_user_roles (admin_user_id, role_id) VALUES (?, ?)", [result.insertId, r.insertId]);
    ctx.roleKeys.push(roleKey);
  }
  const res = await login(email, "StaffOps@1234");
  assert.equal(res.status, 200);
  return { id: result.insertId, email, token: res.json.data.accessToken };
}

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
  const perms = ["dashboard:read", "roles:manage", "permissions:manage", "audit_logs:read"];
  ctx.mainManager = await createAdmin(ctx.main, perms);
  ctx.womenManager = await createAdmin(ctx.women, perms);
  ctx.superAdmin = await createAdmin(ctx.main, [], "super_admin");
  ctx.ready = true;
});

test.after(async () => {
  if (noDb) return;
  const run = async (sql, params) => {
    try {
      if (params.length) await query(sql, params);
    } catch (error) {
      console.error("[staffOps.test.js cleanup]", error.code || error.message);
    }
  };
  const list = (ids) => ids.map(() => "?").join(",");
  const created = (await query("SELECT id FROM admin_users WHERE email LIKE ?", [`%.${RUN}.new@test.local`])).map((r) => r.id);
  const admins = [...ctx.adminIds, ...created];
  await run(`DELETE FROM messages WHERE id IN (${list(ctx.messageIds)})`, ctx.messageIds);
  await run(`DELETE FROM roles WHERE key_name IN (${list(ctx.roleKeys)})`, ctx.roleKeys);
  await run(`DELETE FROM admin_user_roles WHERE admin_user_id IN (${list(admins)})`, admins);
  await run(`DELETE FROM refresh_tokens WHERE admin_user_id IN (${list(admins)})`, admins);
  await run(`DELETE FROM admin_users WHERE id IN (${list(admins)})`, admins);
  if (server) await new Promise((resolve) => server.close(resolve));
  const pool = getPool();
  if (pool) await pool.end();
  for (const [, task] of cron.getTasks()) {
    task.stop();
    task.destroy();
  }
});

test("new staff get a one-time password and must change it before using the panel", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const email = `reception.${RUN}.new@test.local`;
  const created = await api("POST", "/api/v1/staff", { token: ctx.womenManager.token, body: { fullName: "New Reception", email, roleKeys: ["reception"], branchId: ctx.main } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.data.branchId, ctx.women, "spoofed branch ignored");
  assert.equal(created.json.data.mustChangePassword, true);
  const temp = created.json.data.temporaryPassword;

  const first = await login(email, temp);
  assert.equal(first.status, 200);
  const blocked = await api("GET", "/api/v1/admin/overview", { token: first.json.data.accessToken });
  assert.equal(blocked.status, 403);
  const changed = await api("POST", "/api/v1/admin/auth/change-password", { token: first.json.data.accessToken, body: { currentPassword: temp, newPassword: "Reception@2026!" } });
  assert.equal(changed.status, 200);
  const again = await login(email, "Reception@2026!");
  assert.equal((await api("GET", "/api/v1/admin/overview", { token: again.json.data.accessToken })).status, 200);
});

test("super_admin is protected; other branch is a 404; no self-deactivation; reset revokes", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const grant = await api("POST", "/api/v1/staff", { token: ctx.mainManager.token, body: { fullName: "Sneaky", email: `sneaky.${RUN}.new@test.local`, roleKeys: ["super_admin"] } });
  assert.equal(grant.status, 403);
  const superPatch = await api("PATCH", `/api/v1/staff/${ctx.superAdmin.id}`, { token: ctx.mainManager.token, body: { status: "inactive" } });
  assert.equal(superPatch.status, 403);
  assert.equal((await api("PATCH", `/api/v1/staff/${ctx.womenManager.id}`, { token: ctx.mainManager.token, body: { status: "inactive" } })).status, 404);
  assert.equal((await api("POST", `/api/v1/staff/${ctx.womenManager.id}/reset-password`, { token: ctx.mainManager.token })).status, 404);
  assert.equal(
    (await api("POST", "/api/v1/admin/adminRoleAssignments", { token: ctx.mainManager.token, body: { adminId: ctx.womenManager.id, roleKeys: ["reception"] } })).status,
    404,
    "existing role-assignment endpoint is branch-checked too"
  );
  assert.equal((await api("PATCH", `/api/v1/staff/${ctx.mainManager.id}`, { token: ctx.mainManager.token, body: { status: "inactive" } })).status, 422);

  const listed = await api("GET", "/api/v1/staff", { token: ctx.mainManager.token });
  assert.ok(listed.json.data.every((s) => s.branchId === ctx.main));

  const victimEmail = `victim.${RUN}.new@test.local`;
  const victim = await api("POST", "/api/v1/staff", { token: ctx.mainManager.token, body: { fullName: "Victim", email: victimEmail, roleKeys: ["reception"] } });
  const reset = await api("POST", `/api/v1/staff/${victim.json.data.id}/reset-password`, { token: ctx.mainManager.token });
  assert.equal(reset.status, 200);
  assert.equal((await login(victimEmail, victim.json.data.temporaryPassword)).status, 401, "old temp password no longer works");
  assert.equal((await login(victimEmail, reset.json.data.temporaryPassword)).status, 200);
});

test("audit logs are branch-scoped, consolidated only for cross-branch admins, exportable", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const mainLogs = await api("GET", "/api/v1/ops/audit-logs?action=staff.&pageSize=100", { token: ctx.mainManager.token });
  assert.equal(mainLogs.status, 200);
  assert.ok(mainLogs.json.data.items.every((row) => row.branch_id == null || Number(row.branch_id) === ctx.main));
  const womenLogs = await api("GET", "/api/v1/ops/audit-logs?action=staff.create&pageSize=100", { token: ctx.womenManager.token });
  assert.ok(womenLogs.json.data.items.some((row) => Number(row.branch_id) === ctx.women));
  assert.ok(!womenLogs.json.data.items.some((row) => Number(row.branch_id) === ctx.main));
  assert.equal((await api("GET", "/api/v1/ops/audit-logs?scope=all", { token: ctx.mainManager.token })).status, 403);
  assert.equal((await api("GET", "/api/v1/ops/audit-logs?scope=all", { token: ctx.superAdmin.token })).status, 200);
  const xlsx = await api("GET", "/api/v1/ops/audit-logs/export", { token: ctx.mainManager.token, raw: true });
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.headers.get("content-type"), /spreadsheetml/);
});

test("bell feed shows a new lead as unread until the bell is opened", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  await api("POST", "/api/v1/ops/feed/seen", { token: ctx.womenManager.token });
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const result = await query("INSERT INTO messages (branch_id, name, email, phone, subject, message, status) VALUES (?, ?, 'feed@test.local', '0550000000', 'Hi', 'Hello', 'unread')", [
    ctx.women,
    `Feed Lead ${RUN}`
  ]);
  ctx.messageIds.push(result.insertId);
  const feed = await api("GET", "/api/v1/ops/feed", { token: ctx.womenManager.token });
  const item = feed.json.data.items.find((i) => i.type === "lead" && i.id === result.insertId);
  assert.ok(item && item.unread);
  assert.ok(feed.json.data.unread >= 1);
  const mainFeed = await api("GET", "/api/v1/ops/feed", { token: ctx.mainManager.token });
  assert.ok(!mainFeed.json.data.items.some((i) => i.type === "lead" && i.id === result.insertId), "other branch does not see it");
  await api("POST", "/api/v1/ops/feed/seen", { token: ctx.womenManager.token });
  const after = await api("GET", "/api/v1/ops/feed", { token: ctx.womenManager.token });
  assert.equal(after.json.data.unread, 0);
});
