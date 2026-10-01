// Members & leads (Part 2 §2.0.1 / §2.0.7) -- real app + real DB.
//
// Covers: the admin /users list, detail and export are branch-scoped (they
// used to return both branches); contact-form leads belong to the branch
// they were submitted on, the other branch cannot see or act on them, and
// conversion creates the member in the lead's branch; freeze blocks
// check-in and adds the days back, unfreeze returns unused days, extend
// needs a reason and leaves a note; actions on another branch's membership
// are 404s; soft delete stops sign-in; a regenerated card invalidates the old
// QR; list filters (frozen / expiring / at-risk); at-risk task de-duplication.

const test = require("node:test");
const assert = require("node:assert/strict");
const cron = require("node-cron");
const { hasDatabaseConfig, query, getPool } = require("../src/config/database");

const noDb = !hasDatabaseConfig();
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const ctx = { ready: false, userIds: [], planIds: [], adminIds: [], roleKeys: [], messageIds: [] };
let server;
let baseUrl;
let phoneSeq = 0;
const nextPhone = () => `050${String((Date.now() + ++phoneSeq) % 10000000).padStart(7, "0")}`;

async function api(method, path, { token, body, headers = {}, raw = false } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (raw) return res;
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function createAdmin(branchId, permissions) {
  const { hashPassword } = require("../src/utils/hash");
  const email = `members.${branchId}.${RUN}@test.local`;
  const result = await query(
    "INSERT INTO admin_users (branch_id, full_name, email, password_hash, role, status) VALUES (?, 'Members Test', ?, ?, 'staff', 'active')",
    [branchId, email, await hashPassword("MembersAdmin@123")]
  );
  const roleKey = `test_members_${RUN}_${result.insertId}`;
  const role = await query("INSERT INTO roles (key_name, display_name, is_system, is_active) VALUES (?, 'Members Test', 0, 1)", [roleKey]);
  for (const key of permissions) {
    const perm = await query("SELECT id FROM permissions WHERE key_name = ? LIMIT 1", [key]);
    if (perm[0]) await query("INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [role.insertId, perm[0].id]);
  }
  await query("INSERT INTO admin_user_roles (admin_user_id, role_id) VALUES (?, ?)", [result.insertId, role.insertId]);
  ctx.adminIds.push(result.insertId);
  ctx.roleKeys.push(roleKey);
  const login = await api("POST", "/api/v1/admin/auth/login", { body: { identifier: email, password: "MembersAdmin@123" } });
  assert.equal(login.status, 200);
  return { id: result.insertId, token: login.json.data.accessToken };
}

async function member(branchId, label, { membership = "active", startDaysAgo = 5, endInDays = 25 } = {}) {
  const userRepository = require("../src/repositories/userRepository");
  const email = `members.${label}.${RUN}@test.local`;
  const user = await userRepository.createUser({ branchId, fullName: `Members ${label} ${RUN}`, email, phone: nextPhone(), password: "MemberUser@123" });
  ctx.userIds.push(user.id);
  let membershipId = null;
  if (membership) {
    const planId = branchId === ctx.main ? ctx.mainPlan : ctx.womenPlan;
    const res = await query(
      `INSERT INTO memberships (branch_id, user_id, plan_id, status, start_date, end_date)
       VALUES (?, ?, ?, ?, UTC_DATE() - INTERVAL ? DAY, UTC_DATE() + INTERVAL ? DAY)`,
      [branchId, user.id, planId, membership, startDaysAgo, endInDays]
    );
    membershipId = res.insertId;
  }
  const row = (await query("SELECT card_token, member_code FROM users WHERE id = ?", [user.id]))[0];
  return { id: user.id, email, membershipId, cardToken: row.card_token, memberCode: row.member_code };
}

const endDate = async (id) => {
  const row = (await query("SELECT DATE_FORMAT(end_date, '%Y-%m-%d') AS d FROM memberships WHERE id = ?", [id]))[0];
  return row.d;
};
const dayDiff = (a, b) => Math.round((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86400000);

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
  for (const [key, branchId] of [["mainPlan", main.id], ["womenPlan", women.id]]) {
    const plan = await planRepository.savePlan({ nameEn: `Members Plan ${RUN}`, nameAr: "خطة", descriptionEn: "T", descriptionAr: "ت", durationDays: 30, price: 100, branchId });
    ctx[key] = plan.id;
    ctx.planIds.push(plan.id);
  }
  const perms = ["dashboard:read", "users:read", "customers:manage", "memberships:read", "memberships:write", "checkin:manage", "messages:write", "leads:read", "leads:write"];
  ctx.mainAdmin = await createAdmin(main.id, perms);
  ctx.womenAdmin = await createAdmin(women.id, perms);
  ctx.ready = true;
});

test.after(async () => {
  if (noDb) return;
  const run = async (sql, params) => {
    try {
      if (params.length) await query(sql, params);
    } catch (error) {
      console.error("[members.test.js cleanup]", error.code || error.message);
    }
  };
  const list = (ids) => ids.map(() => "?").join(",");
  const converted = (await query(`SELECT converted_user_id FROM messages WHERE id IN (${list(ctx.messageIds.length ? ctx.messageIds : [0])})`, ctx.messageIds.length ? ctx.messageIds : [0]))
    .map((r) => r.converted_user_id)
    .filter(Boolean);
  const users = [...ctx.userIds, ...converted];
  await run(`DELETE FROM tasks WHERE linked_resource_type = 'customer' AND linked_resource_id IN (${list(users)})`, users);
  await run(`DELETE FROM tasks WHERE linked_resource_type = 'message' AND linked_resource_id IN (${list(ctx.messageIds)})`, ctx.messageIds);
  await run(`DELETE FROM lead_notes WHERE message_id IN (${list(ctx.messageIds)})`, ctx.messageIds);
  await run(`DELETE FROM messages WHERE id IN (${list(ctx.messageIds)})`, ctx.messageIds);
  for (const table of ["attendance_logs", "membership_freezes", "customer_notes", "memberships", "notifications", "refresh_tokens", "customer_profiles"]) {
    await run(`DELETE FROM ${table} WHERE user_id IN (${list(users)})`, users);
  }
  await run(`DELETE FROM users WHERE id IN (${list(users)})`, users);
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

test("admin /users list, detail and export are branch-scoped", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const mainMember = await member(ctx.main, "usersscope");
  const listed = await api("GET", `/api/v1/users?search=${encodeURIComponent(`usersscope ${RUN}`)}`, { token: ctx.womenAdmin.token });
  assert.equal(listed.status, 200);
  assert.equal(listed.json.data.items.length, 0, "women admin cannot list a Main member");
  const own = await api("GET", `/api/v1/users?search=${encodeURIComponent(`usersscope ${RUN}`)}`, { token: ctx.mainAdmin.token });
  assert.equal(own.json.data.items.length, 1);
  assert.equal((await api("GET", `/api/v1/users/${mainMember.id}`, { token: ctx.womenAdmin.token })).status, 404);

  const xlsx = await api("GET", "/api/v1/users/export?format=xlsx", { token: ctx.womenAdmin.token, raw: true });
  assert.equal(xlsx.status, 200);
  const ExcelJS = require("exceljs");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));
  const codes = [];
  book.worksheets[0].eachRow((row) => codes.push(String(row.getCell(1).value)));
  assert.ok(!codes.includes(mainMember.memberCode), "export excludes the other branch");
});

test("leads belong to the branch they were submitted on", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const submitted = await api("POST", "/api/v1/messages", {
    headers: { "X-Branch": "women", "X-Forwarded-For": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    body: { name: `Lead ${RUN}`, email: `lead.${RUN}@test.local`, phone: nextPhone(), subject: "Membership", message: "Hello" }
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.json));
  const id = submitted.json.data.id;
  ctx.messageIds.push(id);
  assert.equal(submitted.json.data.branchId, ctx.women);

  const womenList = await api("GET", `/api/v1/messages?search=${encodeURIComponent(`Lead ${RUN}`)}`, { token: ctx.womenAdmin.token });
  assert.ok(womenList.json.data.items.some((m) => m.id === id));
  const mainList = await api("GET", `/api/v1/messages?search=${encodeURIComponent(`Lead ${RUN}`)}`, { token: ctx.mainAdmin.token });
  assert.ok(!mainList.json.data.items.some((m) => m.id === id));

  for (const [method, path, body] of [
    ["PATCH", `/api/v1/messages/${id}/lead`, { leadStatus: "contacted" }],
    ["POST", `/api/v1/messages/${id}/notes`, { note: "x" }],
    ["POST", `/api/v1/messages/${id}/convert`, {}],
    ["DELETE", `/api/v1/messages/${id}`, undefined]
  ]) {
    assert.equal((await api(method, path, { token: ctx.mainAdmin.token, body })).status, 404, `${method} ${path}`);
  }

  const converted = await api("POST", `/api/v1/messages/${id}/convert`, { token: ctx.womenAdmin.token, body: { branchId: ctx.main } });
  assert.equal(converted.status, 201, JSON.stringify(converted.json));
  const user = (await query("SELECT branch_id FROM users WHERE id = ?", [converted.json.data.userId]))[0];
  assert.equal(Number(user.branch_id), ctx.women, "member created in the lead's branch");
});

test("freeze blocks check-in and adds days back; unfreeze returns unused days; extend needs a reason", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const m = await member(ctx.main, "freeze");
  const before = await endDate(m.membershipId);

  const freeze = await api("PATCH", `/api/v1/memberships/${m.membershipId}/action`, { token: ctx.mainAdmin.token, body: { action: "freeze", days: 10, reason: "Travel" } });
  assert.equal(freeze.status, 200, JSON.stringify(freeze.json));
  assert.equal(dayDiff(await endDate(m.membershipId), before), 10);

  const checkIn = await api("POST", "/api/v1/attendance/check-in", { token: ctx.mainAdmin.token, body: { cardToken: m.cardToken } });
  assert.equal(checkIn.json.data.allowed, false);
  assert.equal(checkIn.json.data.reason, "frozen");

  const frozenList = await api("GET", `/api/v1/customers?membershipStatus=frozen&search=${encodeURIComponent(m.memberCode)}`, { token: ctx.mainAdmin.token });
  assert.equal(frozenList.json.data.items[0]?.membershipStatus, "frozen");

  const unfreeze = await api("PATCH", `/api/v1/memberships/${m.membershipId}/action`, { token: ctx.mainAdmin.token, body: { action: "unfreeze" } });
  assert.equal(unfreeze.status, 200);
  assert.equal(unfreeze.json.data.returnedDays, 9, "today was used, 9 days come back");
  assert.equal(dayDiff(await endDate(m.membershipId), before), 1);

  const noReason = await api("PATCH", `/api/v1/memberships/${m.membershipId}/action`, { token: ctx.mainAdmin.token, body: { action: "extend", days: 5 } });
  assert.equal(noReason.status, 422);
  const extend = await api("PATCH", `/api/v1/memberships/${m.membershipId}/action`, { token: ctx.mainAdmin.token, body: { action: "extend", days: 5, reason: "Gym closed for maintenance" } });
  assert.equal(extend.status, 200);
  assert.equal(dayDiff(await endDate(m.membershipId), before), 6);
  const notes = await api("GET", `/api/v1/customers/${m.id}/notes`, { token: ctx.mainAdmin.token });
  assert.ok(notes.json.data.some((n) => /Gym closed for maintenance/.test(n.note)));

  const cross = await api("PATCH", `/api/v1/memberships/${m.membershipId}/action`, { token: ctx.womenAdmin.token, body: { action: "extend", days: 5, reason: "nope nope" } });
  assert.equal(cross.status, 404);
  assert.equal(dayDiff(await endDate(m.membershipId), before), 6);
});

test("notes, regenerated card and soft delete", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const m = await member(ctx.women, "account");
  const note = await api("POST", `/api/v1/customers/${m.id}/notes`, { token: ctx.womenAdmin.token, body: { note: "Prefers morning calls" } });
  assert.equal(note.status, 201);
  assert.equal((await api("POST", `/api/v1/customers/${m.id}/notes`, { token: ctx.mainAdmin.token, body: { note: "x" } })).status, 404);

  const regen = await api("POST", `/api/v1/customers/${m.id}/card`, { token: ctx.womenAdmin.token });
  assert.equal(regen.status, 200);
  const old = await api("POST", "/api/v1/attendance/check-in", { token: ctx.womenAdmin.token, body: { cardToken: m.cardToken } });
  assert.equal(old.json.data.reason, "not_found", "old QR no longer works");

  const login = () => api("POST", "/api/v1/auth/login", { headers: { "X-Branch": "women" }, body: { identifier: m.email, password: "MemberUser@123" } });
  assert.equal((await login()).status, 200);
  assert.equal((await api("DELETE", `/api/v1/customers/${m.id}`, { token: ctx.mainAdmin.token })).status, 404);
  assert.equal((await api("DELETE", `/api/v1/customers/${m.id}`, { token: ctx.womenAdmin.token })).status, 200);
  assert.notEqual((await login()).status, 200, "a deleted account cannot sign in");
});

test("list filters and at-risk follow-up tasks (de-duplicated)", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const expiring = await member(ctx.women, "expiring", { endInDays: 2 });
  const atRisk = await member(ctx.women, "atrisk", { startDaysAgo: 40, endInDays: 20 });
  await query("INSERT INTO attendance_logs (branch_id, user_id, membership_id, check_in_at, method, status) VALUES (?, ?, ?, UTC_TIMESTAMP() - INTERVAL 30 DAY, 'manual', 'checked_out')", [
    ctx.women,
    atRisk.id,
    atRisk.membershipId
  ]);

  const soon = await api("GET", `/api/v1/customers?expiringWithin=3&search=${encodeURIComponent(expiring.memberCode)}`, { token: ctx.womenAdmin.token });
  assert.equal(soon.json.data.items.length, 1);
  assert.equal(soon.json.data.items[0].daysRemaining, 2);

  const inactive = await api("GET", `/api/v1/customers?inactiveDays=14&search=${encodeURIComponent(atRisk.memberCode)}`, { token: ctx.womenAdmin.token });
  assert.equal(inactive.json.data.items.length, 1);

  const cronJobs = require("../src/jobs/cron");
  await cronJobs.atRiskMembers();
  await cronJobs.atRiskMembers();
  const tasks = await query("SELECT branch_id FROM tasks WHERE linked_resource_type = 'customer' AND linked_resource_id = ?", [atRisk.id]);
  assert.equal(tasks.length, 1, "one task, not one per run");
  assert.equal(Number(tasks[0].branch_id), ctx.women);
});
