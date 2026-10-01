// Reception check-in (Part 2) test suite. Boots the real app on an
// ephemeral port and drives POST /api/v1/attendance/check-in with fetch(),
// same style as test/tasks.test.js -- every assertion runs through the real
// auth, attachEffectiveBranch and RBAC chain. Self-skips without DB config.
//
// Covers:
//   1. Active member: QR scan checks in (201); a second scan inside the
//      duplicate window returns the same visit (200, duplicate: true).
//   2. Rejections with a reason and no attendance row: expired, no
//      membership, suspended, unknown code.
//   3. Cross-branch: the other branch's reception gets "wrong_branch" with
//      no member details, and no row is written.
//   4. Manual lookup by email is branch-scoped -- the same email registered
//      under both branches resolves to the scanning branch's account.
//   5. daily-log / summary only show the admin's own branch.

const test = require("node:test");
const assert = require("node:assert/strict");
const cron = require("node-cron");
const { hasDatabaseConfig, query, getPool } = require("../src/config/database");
const app = require("../src/app");
const userRepository = require("../src/repositories/userRepository");
const planRepository = require("../src/repositories/planRepository");
const { hashPassword } = require("../src/utils/hash");

const noDb = !hasDatabaseConfig();
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

let server;
let baseUrl;
const ctx = { ready: false, userIds: [], planIds: [], adminIds: [], roleKeys: [] };

let phoneSeq = 0;
function nextPhone() {
  phoneSeq += 1;
  const suffix = String((Date.now() + phoneSeq) % 10000000).padStart(7, "0");
  return `056${suffix}`;
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let json = null;
  try {
    json = await res.json();
  } catch (_error) {
    json = null;
  }
  return { status: res.status, json };
}

async function createScopedAdmin(branchId, email, permissionKeys, password) {
  const adminResult = await query(
    `INSERT INTO admin_users (branch_id, full_name, email, password_hash, role, status)
     VALUES (?, ?, ?, ?, 'staff', 'active')`,
    [branchId, "Check-in Test Admin", email, await hashPassword(password)]
  );
  const adminId = adminResult.insertId;
  const roleKey = `test_checkin_${RUN}_${adminId}`;
  const roleResult = await query(`INSERT INTO roles (key_name, display_name, is_system, is_active) VALUES (?, ?, 0, 1)`, [
    roleKey,
    "Check-in Test Role"
  ]);
  for (const key of permissionKeys) {
    const perm = await query("SELECT id FROM permissions WHERE key_name = ? LIMIT 1", [key]);
    if (perm[0]) {
      await query("INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleResult.insertId, perm[0].id]);
    }
  }
  await query("INSERT INTO admin_user_roles (admin_user_id, role_id) VALUES (?, ?)", [adminId, roleResult.insertId]);
  ctx.adminIds.push(adminId);
  ctx.roleKeys.push(roleKey);
  return adminId;
}

async function login(email, password) {
  const res = await api("POST", "/api/v1/admin/auth/login", { body: { identifier: email, password } });
  assert.equal(res.status, 200, `setup: admin login must succeed for ${email}`);
  return res.json.data.accessToken;
}

async function createMember(branchId, label, { email, status = "active", membership = "active" } = {}) {
  const user = await userRepository.createUser({
    branchId,
    fullName: `Check-in ${label}`,
    email: email || `checkin.${label}.${RUN}@test.local`,
    phone: nextPhone(),
    password: "MemberUser@123"
  });
  ctx.userIds.push(user.id);
  if (status !== "active") {
    await query("UPDATE users SET status = ? WHERE id = ?", [status, user.id]);
  }
  const planId = branchId === ctx.mainBranchId ? ctx.mainPlanId : ctx.womenPlanId;
  if (membership === "active") {
    await query(
      `INSERT INTO memberships (branch_id, user_id, plan_id, status, start_date, end_date)
       VALUES (?, ?, ?, 'active', UTC_DATE() - INTERVAL 5 DAY, UTC_DATE() + INTERVAL 25 DAY)`,
      [branchId, user.id, planId]
    );
  } else if (membership === "expired") {
    await query(
      `INSERT INTO memberships (branch_id, user_id, plan_id, status, start_date, end_date)
       VALUES (?, ?, ?, 'expired', UTC_DATE() - INTERVAL 40 DAY, UTC_DATE() - INTERVAL 10 DAY)`,
      [branchId, user.id, planId]
    );
  }
  const rows = await query("SELECT card_token FROM users WHERE id = ?", [user.id]);
  return { id: user.id, cardToken: rows[0].card_token, email: user.email };
}

async function attendanceCount(userId) {
  const rows = await query("SELECT COUNT(*) AS total FROM attendance_logs WHERE user_id = ?", [userId]);
  return Number(rows[0].total);
}

test.before(async () => {
  if (noDb) return;

  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const branches = await query("SELECT id, code FROM branches WHERE code IN ('main', 'women')");
  const main = branches.find((row) => row.code === "main");
  const women = branches.find((row) => row.code === "women");
  if (!main || !women) return;
  ctx.mainBranchId = main.id;
  ctx.womenBranchId = women.id;

  for (const [key, branchId] of [["mainPlanId", main.id], ["womenPlanId", women.id]]) {
    const plan = await planRepository.savePlan({
      nameEn: `Check-in Plan ${RUN}`,
      nameAr: "خطة اختبار الدخول",
      descriptionEn: "Test plan",
      descriptionAr: "خطة تجريبية",
      durationDays: 30,
      price: 50,
      branchId
    });
    ctx[key] = plan.id;
    ctx.planIds.push(plan.id);
  }

  const password = "CheckinAdmin@123";
  const mainEmail = `checkinmain.${RUN}@test.local`;
  const womenEmail = `checkinwomen.${RUN}@test.local`;
  await createScopedAdmin(main.id, mainEmail, ["dashboard:read", "checkin:manage"], password);
  await createScopedAdmin(women.id, womenEmail, ["dashboard:read", "checkin:manage"], password);
  ctx.mainToken = await login(mainEmail, password);
  ctx.womenToken = await login(womenEmail, password);

  ctx.ready = true;
});

test.after(async () => {
  if (noDb) return;

  const tryDelete = async (label, sql, params) => {
    try {
      await query(sql, params);
    } catch (error) {
      console.error(`[checkin.test.js cleanup] ${label} failed:`, error.code || error.message);
    }
  };
  const ids = (list) => (list.length ? list : [0]);

  await tryDelete("attendance", `DELETE FROM attendance_logs WHERE user_id IN (${ids(ctx.userIds).map(() => "?").join(",")})`, ids(ctx.userIds));
  await tryDelete("memberships", `DELETE FROM memberships WHERE user_id IN (${ids(ctx.userIds).map(() => "?").join(",")})`, ids(ctx.userIds));
  await tryDelete("users", `DELETE FROM users WHERE id IN (${ids(ctx.userIds).map(() => "?").join(",")})`, ids(ctx.userIds));
  await tryDelete("plans", `DELETE FROM plans WHERE id IN (${ids(ctx.planIds).map(() => "?").join(",")})`, ids(ctx.planIds));
  await tryDelete("roles", `DELETE FROM roles WHERE key_name IN (${(ctx.roleKeys.length ? ctx.roleKeys : [""]).map(() => "?").join(",")})`, ctx.roleKeys.length ? ctx.roleKeys : [""]);
  await tryDelete("admin_users", `DELETE FROM admin_users WHERE id IN (${ids(ctx.adminIds).map(() => "?").join(",")})`, ids(ctx.adminIds));

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  const pool = getPool();
  if (pool) {
    await pool.end();
  }
  for (const [, task] of cron.getTasks()) {
    task.stop();
    task.destroy();
  }
});

test("active member: QR scan checks in once, a re-scan returns the same visit", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const member = await createMember(ctx.mainBranchId, "active");

  const first = await api("POST", "/api/v1/attendance/check-in", {
    token: ctx.mainToken,
    body: { code: `https://example.test/card.html?t=${member.cardToken}`, method: "qr" }
  });
  assert.equal(first.status, 201);
  assert.equal(first.json.data.allowed, true);
  assert.equal(first.json.data.duplicate, false);
  assert.equal(first.json.data.member.id, member.id);

  const second = await api("POST", "/api/v1/attendance/check-in", {
    token: ctx.mainToken,
    body: { cardToken: member.cardToken, method: "qr" }
  });
  assert.equal(second.status, 200);
  assert.equal(second.json.data.allowed, true);
  assert.equal(second.json.data.duplicate, true);
  assert.equal(second.json.data.attendance.id, first.json.data.attendance.id);
  assert.equal(await attendanceCount(member.id), 1);
});

test("concurrent scans of the same member write a single attendance row", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const member = await createMember(ctx.mainBranchId, "concurrent");
  const results = await Promise.all(
    [1, 2, 3].map(() => api("POST", "/api/v1/attendance/check-in", { token: ctx.mainToken, body: { cardToken: member.cardToken } }))
  );
  assert.ok(results.every((res) => res.json.data.allowed));
  assert.equal(results.filter((res) => res.status === 201).length, 1);
  assert.equal(await attendanceCount(member.id), 1);
});

test("rejections carry a reason and write no attendance row", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const expired = await createMember(ctx.mainBranchId, "expired", { membership: "expired" });
  const none = await createMember(ctx.mainBranchId, "none", { membership: "none" });
  const suspended = await createMember(ctx.mainBranchId, "suspended", { status: "suspended" });

  for (const [member, reason] of [[expired, "expired"], [none, "no_active_membership"], [suspended, "suspended"]]) {
    const res = await api("POST", "/api/v1/attendance/check-in", { token: ctx.mainToken, body: { cardToken: member.cardToken } });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.allowed, false);
    assert.equal(res.json.data.reason, reason);
    assert.equal(await attendanceCount(member.id), 0);
  }

  const unknown = await api("POST", "/api/v1/attendance/check-in", { token: ctx.mainToken, body: { code: "0".repeat(32) } });
  assert.equal(unknown.json.data.allowed, false);
  assert.equal(unknown.json.data.reason, "not_found");
});

test("the other branch's reception gets wrong_branch with no member details", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const member = await createMember(ctx.mainBranchId, "crossbranch");
  const res = await api("POST", "/api/v1/attendance/check-in", { token: ctx.womenToken, body: { cardToken: member.cardToken } });
  assert.equal(res.json.data.allowed, false);
  assert.equal(res.json.data.reason, "wrong_branch");
  assert.equal(res.json.data.member, null);
  assert.equal(await attendanceCount(member.id), 0);
});

test("manual lookup by email resolves to the scanning branch's account", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const sharedEmail = `checkin.shared.${RUN}@test.local`;
  const mainMember = await createMember(ctx.mainBranchId, "shared-main", { email: sharedEmail });
  const womenMember = await createMember(ctx.womenBranchId, "shared-women", { email: sharedEmail });

  const women = await api("POST", "/api/v1/attendance/check-in", { token: ctx.womenToken, body: { query: sharedEmail } });
  assert.equal(women.json.data.allowed, true);
  assert.equal(women.json.data.member.id, womenMember.id);

  const main = await api("POST", "/api/v1/attendance/check-in", { token: ctx.mainToken, body: { query: sharedEmail } });
  assert.equal(main.json.data.allowed, true);
  assert.equal(main.json.data.member.id, mainMember.id);
});

test("daily log and summary only include the admin's own branch", { skip: noDb }, async () => {
  if (!ctx.ready) return;
  const member = await createMember(ctx.womenBranchId, "dailylog");
  const checkIn = await api("POST", "/api/v1/attendance/check-in", { token: ctx.womenToken, body: { cardToken: member.cardToken } });
  assert.equal(checkIn.status, 201);

  const womenLog = await api("GET", "/api/v1/attendance/daily-log", { token: ctx.womenToken });
  assert.ok(womenLog.json.data.some((row) => row.user_id === member.id));
  const mainLog = await api("GET", "/api/v1/attendance/daily-log", { token: ctx.mainToken });
  assert.ok(!mainLog.json.data.some((row) => row.user_id === member.id));

  const summary = await api("GET", "/api/v1/attendance/summary", { token: ctx.womenToken });
  assert.equal(summary.status, 200);
  assert.ok(summary.json.data.today >= 1);
});
