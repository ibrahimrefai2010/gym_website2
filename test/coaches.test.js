// Coaches (Part 2 §2.0.2 / §2.7.3) -- real app + real DB.
//
// Covers: create/update/soft-delete within the admin's own branch; by-id
// access to another branch's coach is a 404; assigning a member from the
// other branch is a 404 (no existence leak) and nothing is written; the
// coach detail lists assigned members; the PUBLIC bootstrap only returns
// the resolved branch's ACTIVE coaches; a coaches:manage admin can upload a
// photo without settings:write.

const test = require("node:test");
const assert = require("node:assert/strict");
const cron = require("node-cron");
const { hasDatabaseConfig, query, getPool } = require("../src/config/database");

const noDb = !hasDatabaseConfig();
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const ctx = { ready: false, userIds: [], adminIds: [], roleKeys: [], coachIds: [] };
let server;
let baseUrl;
let phoneSeq = 0;
const nextPhone = () => `051${String((Date.now() + ++phoneSeq) % 10000000).padStart(7, "0")}`;

async function api(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function createAdmin(branchId, permissions) {
  const { hashPassword } = require("../src/utils/hash");
  const email = `coaches.${branchId}.${RUN}@test.local`;
  const result = await query(
    "INSERT INTO admin_users (branch_id, full_name, email, password_hash, role, status) VALUES (?, 'Coach Test', ?, ?, 'staff', 'active')",
    [branchId, email, await hashPassword("CoachAdmin@123")]
  );
  const roleKey = `test_coaches_${RUN}_${result.insertId}`;
  const role = await query("INSERT INTO roles (key_name, display_name, is_system, is_active) VALUES (?, 'Coach Test', 0, 1)", [roleKey]);
  for (const key of permissions) {
    const perm = await query("SELECT id FROM permissions WHERE key_name = ? LIMIT 1", [key]);
    if (perm[0]) await query("INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [role.insertId, perm[0].id]);
  }
  await query("INSERT INTO admin_user_roles (admin_user_id, role_id) VALUES (?, ?)", [result.insertId, role.insertId]);
  ctx.adminIds.push(result.insertId);
  ctx.roleKeys.push(roleKey);
  const login = await api("POST", "/api/v1/admin/auth/login", { body: { identifier: email, password: "CoachAdmin@123" } });
  assert.equal(login.status, 200);
  return { id: result.insertId, token: login.json.data.accessToken };
}

async function createCoach(admin, nameEn, extra = {}) {
  const res = await api("POST", "/api/v1/coaches", {
    token: admin.token,
    body: { nameEn, nameAr: `مدرب ${nameEn}`, specialtyEn: "Strength", specialtyAr: "القوة", yearsExperience: 5, ...extra }
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  ctx.coachIds.push(res.json.data.id);
  return res.json.data;
}

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
  ctx.mainAdmin = await createAdmin(main.id, ["dashboard:read", "coaches:manage"]);
  ctx.womenAdmin = await createAdmin(women.id, ["dashboard:read", "coaches:manage"]);
  ctx.ready = true;
});

test.after(async () => {
  if (noDb) return;
  const run = async (sql, params) => {
    try {
      if (params.length) await query(sql, params);
    } catch (error) {
      console.error("[coaches.test.js cleanup]", error.code || error.message);
    }
  };
  const list = (ids) => ids.map(() => "?").join(",");
  await run(`DELETE FROM customer_profiles WHERE user_id IN (${list(ctx.userIds)})`, ctx.userIds);
  await run(`DELETE FROM users WHERE id IN (${list(ctx.userIds)})`, ctx.userIds);
  await run(`DELETE FROM coaches WHERE id IN (${list(ctx.coachIds)})`, ctx.coachIds);
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

test("coach CRUD stays inside the admin's branch; other branch's coach is a 404", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const coach = await createCoach(ctx.mainAdmin, `Main ${RUN}`, { branchId: ctx.women });
  assert.equal(coach.branchId, ctx.main, "spoofed branchId ignored for a non-switching admin");

  const updated = await api("PUT", `/api/v1/coaches/${coach.id}`, { token: ctx.mainAdmin.token, body: { nameEn: `Main ${RUN} v2`, nameAr: "مدرب", displayOrder: 3 } });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.data.displayOrder, 3);

  for (const [method, path] of [["GET", `/api/v1/coaches/${coach.id}`], ["PUT", `/api/v1/coaches/${coach.id}`], ["DELETE", `/api/v1/coaches/${coach.id}`]]) {
    const res = await api(method, path, { token: ctx.womenAdmin.token, body: method === "PUT" ? { nameEn: "x", nameAr: "x" } : undefined });
    assert.equal(res.status, 404, `${method} ${path}`);
  }
  const list = await api("GET", "/api/v1/coaches?includeInactive=true", { token: ctx.womenAdmin.token });
  assert.ok(!list.json.data.some((row) => row.id === coach.id));

  const removed = await api("DELETE", `/api/v1/coaches/${coach.id}`, { token: ctx.mainAdmin.token });
  assert.equal(removed.status, 200);
  const row = (await query("SELECT deleted_at FROM coaches WHERE id = ?", [coach.id]))[0];
  assert.ok(row.deleted_at, "soft-deleted, not removed");
});

test("member assignment: same branch works and is listed; other branch's member is a 404", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const userRepository = require("../src/repositories/userRepository");
  const coach = await createCoach(ctx.womenAdmin, `Women ${RUN}`);
  const mine = await userRepository.createUser({ branchId: ctx.women, fullName: "Coach member", email: `coach.mine.${RUN}@test.local`, phone: nextPhone(), password: "MemberUser@123" });
  const other = await userRepository.createUser({ branchId: ctx.main, fullName: "Other member", email: `coach.other.${RUN}@test.local`, phone: nextPhone(), password: "MemberUser@123" });
  ctx.userIds.push(mine.id, other.id);

  const ok = await api("POST", `/api/v1/coaches/${coach.id}/assign`, { token: ctx.womenAdmin.token, body: { userId: mine.id } });
  assert.equal(ok.status, 200);
  const detail = await api("GET", `/api/v1/coaches/${coach.id}`, { token: ctx.womenAdmin.token });
  assert.ok(detail.json.data.members.some((m) => m.id === mine.id));

  const cross = await api("POST", `/api/v1/coaches/${coach.id}/assign`, { token: ctx.womenAdmin.token, body: { userId: other.id } });
  assert.equal(cross.status, 404);
  const profile = await query("SELECT coach_id FROM customer_profiles WHERE user_id = ?", [other.id]);
  assert.ok(!profile[0] || profile[0].coach_id == null);
});

test("public bootstrap lists only the resolved branch's active coaches", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const active = await createCoach(ctx.womenAdmin, `Public ${RUN}`);
  const hidden = await createCoach(ctx.womenAdmin, `Hidden ${RUN}`, { isActive: false });
  const women = await api("GET", "/api/v1/public/bootstrap", { headers: { "X-Branch": "women" } });
  const main = await api("GET", "/api/v1/public/bootstrap", { headers: { "X-Branch": "main" } });
  const ids = (res) => (res.json.data.coaches || []).map((c) => c.id);
  assert.ok(ids(women).includes(active.id));
  assert.ok(!ids(women).includes(hidden.id), "inactive coach hidden");
  assert.ok(!ids(main).includes(active.id), "other branch's coach not shown");
});

test("a coaches:manage admin can upload a coach photo", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  // 1x1 transparent PNG
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const res = await api("POST", "/api/v1/admin/uploads/images", { token: ctx.mainAdmin.token, body: { dataUrl: `data:image/png;base64,${png}`, fileName: "coach.png" } });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const url = res.json.data.url || res.json.data.imageUrl;
  assert.ok(url);
  const fs = require("fs");
  const path = require("path");
  fs.rmSync(path.join(__dirname, "..", "public", url.replace(/^\//, "")), { force: true });
});
