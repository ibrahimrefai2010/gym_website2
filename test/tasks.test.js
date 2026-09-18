// Tasks / Follow-ups (Part 2 phase 1) test suite. Boots the real app
// (src/app.js) on an ephemeral local port and drives it with plain fetch(),
// same style as test/crossBranchSecurity.test.js -- every assertion goes
// through the real middleware chain (auth, attachEffectiveBranch, RBAC,
// branch ownership), not just the repository layer directly. Self-skips
// entirely without DB config, matching this repo's other *.test.js files;
// an early `if (!ctx.ready) return;` no-ops individual tests if a required
// fixture (the Women's branch row) isn't present, mirroring
// test/crossBranchSecurity.test.js's own idiom.
//
// Covers:
//   1. CRUD basics: create/list/detail/update/close/cancel.
//   2. By-id branch ownership: a cross-branch task access is a 404, not the
//      data (same gap class Part 1 fixed everywhere else in this app).
//   3. Both real auto-generation triggers, end to end against the real DB:
//      a new contact-form lead (via the actual public route) and an
//      expiring membership (via the actual cron job function).

const test = require("node:test");
const assert = require("node:assert/strict");
const cron = require("node-cron");
const { hasDatabaseConfig, query, getPool } = require("../src/config/database");
const app = require("../src/app");
const cronJobs = require("../src/jobs/cron");
const userRepository = require("../src/repositories/userRepository");
const planRepository = require("../src/repositories/planRepository");
const membershipRepository = require("../src/repositories/membershipRepository");
const { hashPassword } = require("../src/utils/hash");

const noDb = !hasDatabaseConfig();
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

let server;
let baseUrl;
const ctx = {
  ready: false,
  leadMessageId: null,
  expiringMembershipId: null,
  expiringUserId: null,
  expiringPlanId: null
};

let phoneSeq = 0;
function nextPhone() {
  phoneSeq += 1;
  const suffix = String((Date.now() + phoneSeq) % 10000000).padStart(7, "0");
  return `055${suffix}`;
}

async function api(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
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
  const passwordHash = await hashPassword(password);
  const adminResult = await query(
    `INSERT INTO admin_users (branch_id, full_name, email, password_hash, role, status)
     VALUES (?, ?, ?, ?, 'staff', 'active')`,
    [branchId, "Tasks Test Admin", email, passwordHash]
  );
  const adminId = adminResult.insertId;

  // A dedicated RBAC role per test admin (not one of the seeded default
  // roles), same reasoning as crossBranchSecurity.test.js's own helper: an
  // exact, independent permission set, and guaranteed no branches:manage
  // (these must be non-switching admins for the by-id ownership test to
  // mean anything).
  const roleKey = `test_tasks_${RUN}_${adminId}`;
  const roleResult = await query(`INSERT INTO roles (key_name, display_name, is_system, is_active) VALUES (?, ?, 0, 1)`, [
    roleKey,
    "Tasks Test Role"
  ]);
  const roleId = roleResult.insertId;

  for (const key of permissionKeys) {
    const perm = await query("SELECT id FROM permissions WHERE key_name = ? LIMIT 1", [key]);
    if (perm[0]) {
      await query("INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, perm[0].id]);
    }
  }
  await query("INSERT INTO admin_user_roles (admin_user_id, role_id) VALUES (?, ?)", [adminId, roleId]);

  return { adminId, roleKey };
}

test.before(async () => {
  if (noDb) return;

  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const branches = await query("SELECT id, code FROM branches WHERE code IN ('main', 'women')");
  const main = branches.find((row) => row.code === "main");
  const women = branches.find((row) => row.code === "women");
  if (!main || !women) {
    return; // Women's branch row missing on this DB -- individual tests no-op.
  }
  ctx.mainBranchId = main.id;
  ctx.womenBranchId = women.id;

  ctx.adminPassword = "TasksAdmin@123";
  ctx.mainAdminEmail = `tasksmainadmin.${RUN}@test.local`;
  ctx.womenAdminEmail = `taskswomenadmin.${RUN}@test.local`;
  const mainAdmin = await createScopedAdmin(main.id, ctx.mainAdminEmail, ["dashboard:read", "tasks:manage"], ctx.adminPassword);
  const womenAdmin = await createScopedAdmin(women.id, ctx.womenAdminEmail, ["dashboard:read", "tasks:manage"], ctx.adminPassword);
  ctx.mainAdminId = mainAdmin.adminId;
  ctx.mainAdminRoleKey = mainAdmin.roleKey;
  ctx.womenAdminId = womenAdmin.adminId;
  ctx.womenAdminRoleKey = womenAdmin.roleKey;

  const mainLogin = await api("POST", "/api/v1/admin/auth/login", {
    body: { identifier: ctx.mainAdminEmail, password: ctx.adminPassword }
  });
  const womenLogin = await api("POST", "/api/v1/admin/auth/login", {
    body: { identifier: ctx.womenAdminEmail, password: ctx.adminPassword }
  });
  assert.equal(mainLogin.status, 200, "setup: main admin login must succeed");
  assert.equal(womenLogin.status, 200, "setup: women admin login must succeed");
  ctx.mainAdminToken = mainLogin.json.data.accessToken;
  ctx.womenAdminToken = womenLogin.json.data.accessToken;

  ctx.ready = true;
});

test.after(async () => {
  if (noDb) return;

  // Not gated behind ctx.ready, same reasoning as crossBranchSecurity's own
  // after-hook: clean up whatever actually got created, even on a partial
  // failure. Every id read below defaults to null, which binds fine (no
  // row matches) rather than throwing on an undefined bind parameter.
  const tryDelete = async (label, sql, params) => {
    try {
      await query(sql, params);
    } catch (error) {
      console.error(`[tasks.test.js cleanup] ${label} failed:`, error.code || error.message);
    }
  };

  await tryDelete("tasks (admin-created)", "DELETE FROM tasks WHERE created_by IN (?, ?)", [
    ctx.mainAdminId ?? 0,
    ctx.womenAdminId ?? 0
  ]);
  await tryDelete("tasks (auto: lead)", "DELETE FROM tasks WHERE linked_resource_type = 'message' AND linked_resource_id = ?", [
    ctx.leadMessageId
  ]);
  await tryDelete(
    "tasks (auto: membership)",
    "DELETE FROM tasks WHERE linked_resource_type = 'membership' AND linked_resource_id = ?",
    [ctx.expiringMembershipId]
  );
  await tryDelete("messages", "DELETE FROM messages WHERE id = ?", [ctx.leadMessageId]);
  await tryDelete("payments", "DELETE FROM payments WHERE user_id = ?", [ctx.expiringUserId ?? 0]);
  await tryDelete("memberships", "DELETE FROM memberships WHERE id = ?", [ctx.expiringMembershipId]);
  await tryDelete("plans", "DELETE FROM plans WHERE id = ?", [ctx.expiringPlanId]);
  await tryDelete("users", "DELETE FROM users WHERE id = ?", [ctx.expiringUserId]);
  await tryDelete("roles", "DELETE FROM roles WHERE key_name IN (?, ?)", [ctx.mainAdminRoleKey ?? "", ctx.womenAdminRoleKey ?? ""]);
  await tryDelete("admin_users", "DELETE FROM admin_users WHERE id IN (?, ?)", [ctx.mainAdminId ?? 0, ctx.womenAdminId ?? 0]);

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  const pool = getPool();
  if (pool) {
    await pool.end();
  }

  // Requiring src/jobs/cron.js (to call the real renewalReminders() function
  // for the auto-generation test below) also runs its top-level
  // cron.schedule(...) calls, same as booting the real server would -- those
  // register persistent node-cron timers that otherwise keep this test
  // process alive forever after all tests finish. Stop + destroy every
  // scheduled task so `node --test` can actually exit.
  for (const [, task] of cron.getTasks()) {
    task.stop();
    task.destroy();
  }
});

test("create/list/detail/update/close task lifecycle for a branch-scoped admin", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const create = await api("POST", "/api/v1/tasks", {
    token: ctx.mainAdminToken,
    body: { title: `Test task ${RUN}`, description: "First follow-up", priority: "high", dueDate: "2027-01-01" }
  });
  assert.equal(create.status, 201);
  assert.equal(create.json.data.branchId, ctx.mainBranchId, "task must land in the creating admin's own branch, not a client-supplied one");
  assert.equal(create.json.data.status, "open");
  assert.equal(create.json.data.priority, "high");
  const taskId = create.json.data.id;

  const list = await api("GET", "/api/v1/tasks", { token: ctx.mainAdminToken });
  assert.equal(list.status, 200);
  assert.ok(list.json.data.items.some((item) => item.id === taskId), "the new task must appear in the branch's task list");

  const detail = await api("GET", `/api/v1/tasks/${taskId}`, { token: ctx.mainAdminToken });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.data.title, `Test task ${RUN}`);

  const update = await api("PATCH", `/api/v1/tasks/${taskId}`, {
    token: ctx.mainAdminToken,
    body: { status: "in_progress", priority: "urgent", assignedTo: ctx.mainAdminId }
  });
  assert.equal(update.status, 200);
  assert.equal(update.json.data.status, "in_progress");
  assert.equal(update.json.data.priority, "urgent");
  assert.equal(update.json.data.assignedTo, ctx.mainAdminId);

  const close = await api("PATCH", `/api/v1/tasks/${taskId}/close`, {
    token: ctx.mainAdminToken,
    body: { outcomeNote: "Handled by phone." }
  });
  assert.equal(close.status, 200);
  assert.equal(close.json.data.status, "done");
  assert.equal(close.json.data.outcomeNote, "Handled by phone.");
});

test("cancel is a soft delete: status becomes cancelled, the row is never hard-deleted", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const create = await api("POST", "/api/v1/tasks", { token: ctx.mainAdminToken, body: { title: `Cancel task ${RUN}` } });
  assert.equal(create.status, 201);
  const taskId = create.json.data.id;

  const cancel = await api("PATCH", `/api/v1/tasks/${taskId}/cancel`, { token: ctx.mainAdminToken });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.json.data.status, "cancelled");

  const rows = await query("SELECT id, status FROM tasks WHERE id = ?", [taskId]);
  assert.equal(rows.length, 1, "cancel must not hard-delete the row");
  assert.equal(rows[0].status, "cancelled");
});

test("by-id branch ownership: a branch-scoped admin gets 404 -- not the data -- for another branch's task", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const create = await api("POST", "/api/v1/tasks", { token: ctx.womenAdminToken, body: { title: `Women task ${RUN}` } });
  assert.equal(create.status, 201);
  assert.equal(create.json.data.branchId, ctx.womenBranchId);
  const womenTaskId = create.json.data.id;

  const crossBranchGet = await api("GET", `/api/v1/tasks/${womenTaskId}`, { token: ctx.mainAdminToken });
  assert.equal(crossBranchGet.status, 404);
  assert.equal(crossBranchGet.json.data, undefined);

  const crossBranchUpdate = await api("PATCH", `/api/v1/tasks/${womenTaskId}`, {
    token: ctx.mainAdminToken,
    body: { title: "Should not apply" }
  });
  assert.equal(crossBranchUpdate.status, 404);

  const crossBranchClose = await api("PATCH", `/api/v1/tasks/${womenTaskId}/close`, { token: ctx.mainAdminToken });
  assert.equal(crossBranchClose.status, 404);

  const crossBranchCancel = await api("PATCH", `/api/v1/tasks/${womenTaskId}/cancel`, { token: ctx.mainAdminToken });
  assert.equal(crossBranchCancel.status, 404);

  const crossBranchList = await api("GET", "/api/v1/tasks", { token: ctx.mainAdminToken });
  assert.equal(crossBranchList.status, 200);
  assert.ok(
    !crossBranchList.json.data.items.some((item) => item.id === womenTaskId),
    "list-level filtering must also exclude the other branch's task"
  );

  const ownBranch = await api("GET", `/api/v1/tasks/${womenTaskId}`, { token: ctx.womenAdminToken });
  assert.equal(ownBranch.status, 200, "positive control: the same admin must still read their own branch's task");
});

test("auto-generation trigger: a new contact-form lead creates a follow-up task linked to the message", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const email = `lead.${RUN}@test.local`;
  const create = await api("POST", "/api/v1/messages", {
    body: {
      name: "Auto Lead Tester",
      email,
      phone: nextPhone(),
      subject: "Tour request",
      message: "I would like to book a tour this week."
    },
    headers: { "X-Branch": "main" }
  });
  assert.equal(create.status, 201);
  ctx.leadMessageId = create.json.data.id;

  // The trigger is fired as a best-effort background call (see
  // messageController.create) so the HTTP response doesn't wait on it --
  // give it a moment to land before asserting.
  await new Promise((resolve) => setTimeout(resolve, 400));

  const rows = await query(
    "SELECT id, branch_id, title, status, linked_resource_type, linked_resource_id FROM tasks WHERE linked_resource_type = 'message' AND linked_resource_id = ? LIMIT 1",
    [ctx.leadMessageId]
  );
  assert.equal(rows.length, 1, "a task must be auto-created for the new lead");
  assert.equal(rows[0].branch_id, ctx.mainBranchId, "the task must be scoped to the branch the contact form was submitted to");
  assert.equal(rows[0].status, "open");
  assert.match(rows[0].title, /Auto Lead Tester/);
});

test("auto-generation trigger: an expiring membership creates a follow-up task via the renewal-reminder cron", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const plan = await planRepository.savePlan({
    nameEn: `Tasks Expiry Plan ${RUN}`,
    nameAr: "خطة تجريبية للمهام",
    descriptionEn: "Test plan",
    descriptionAr: "خطة تجريبية",
    durationDays: 30,
    price: 50,
    branchId: ctx.mainBranchId
  });
  ctx.expiringPlanId = plan.id;

  const user = await userRepository.createUser({
    branchId: ctx.mainBranchId,
    fullName: "Expiring Membership Tester",
    email: `expiring.${RUN}@test.local`,
    phone: nextPhone(),
    password: "MemberUser@123"
  });
  ctx.expiringUserId = user.id;

  const purchase = await membershipRepository.buy({ userId: user.id, planId: plan.id });
  ctx.expiringMembershipId = purchase.membership.id;

  // Force end_date to exactly 7 days out -- the first threshold in
  // src/jobs/cron.js's RENEWAL_REMINDER_DAYS -- then run the actual cron
  // function (not a re-implementation of its query) to prove the real
  // trigger point creates a task end to end.
  await query("UPDATE memberships SET end_date = UTC_DATE() + INTERVAL 7 DAY, status = 'active' WHERE id = ?", [
    ctx.expiringMembershipId
  ]);

  await cronJobs.renewalReminders();

  const rows = await query(
    "SELECT id, branch_id, title, status, priority, linked_resource_type, linked_resource_id FROM tasks WHERE linked_resource_type = 'membership' AND linked_resource_id = ? LIMIT 1",
    [ctx.expiringMembershipId]
  );
  assert.equal(rows.length, 1, "a task must be auto-created for the expiring membership");
  assert.equal(rows[0].branch_id, ctx.mainBranchId);
  assert.equal(rows[0].status, "open");
  assert.equal(rows[0].priority, "medium", "7-day-out window maps to medium priority");
  assert.match(rows[0].title, /Expiring Membership Tester/);
});
