// Leads / CRM (Part 2) test suite. Boots the real app (src/app.js) on an
// ephemeral local port and drives it with plain fetch(), same style as
// test/tasks.test.js and test/crossBranchSecurity.test.js -- every
// assertion goes through the real middleware chain (auth, RBAC/permissions),
// not just the repository layer directly. Self-skips entirely without DB
// config; an early `if (!ctx.ready) return;` no-ops individual tests if the
// Main branch row isn't present, mirroring the other suites' own idiom.
//
// Fixture leads are created directly via messageRepository.createMessage
// (not via the public HTTP route) except where the test is specifically
// about that public route (the spam-protection test) -- the public contact
// route is rate-limited to 1 request per IP per 10 minutes
// (src/routes/messageRoutes.js's contactLimiter), so this suite cannot
// create more than one real submission per process without tripping it
// itself; test/tasks.test.js already covers the ordinary "a real submission
// creates a message" path end to end in its own separate process.
//
// Covers:
//   1. List/filter (status, leadStatus, assignedTo) and the requireAnyPermission
//      OR-gate on the list route (messages:write OR leads:read).
//   2. Lead pipeline write (lead_status/assigned_to) gated by leads:write,
//      separate from the plain-inbox messages:write permission.
//   3. Follow-up notes CRUD, gated by leads:write (add) / leads:read+write (view).
//   4. Convert Lead -> Member: happy path, double-convert (409), and the
//      "email/phone already a member" case (409), reusing
//      customerRepository.createCustomer's existing duplicate handling.
//   5. Spam protection: honeypot silently discards (no row, 200 not 201),
//      and that same request still consumes the per-IP rate limit slot, so
//      an immediate real follow-up submission is rejected (429).

const test = require("node:test");
const assert = require("node:assert/strict");
const { hasDatabaseConfig, query, getPool } = require("../src/config/database");
const app = require("../src/app");
const messageRepository = require("../src/repositories/messageRepository");
const { hashPassword } = require("../src/utils/hash");

const noDb = !hasDatabaseConfig();
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

let server;
let baseUrl;
const ctx = {
  ready: false,
  messageIds: [],
  userIds: []
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

// Identical helper to test/tasks.test.js's own -- a dedicated, independent
// RBAC role per test admin (not a seeded default role) so each admin's
// permission set is exact and isolated from the seeded catalog.
async function createScopedAdmin(branchId, email, permissionKeys, password) {
  const passwordHash = await hashPassword(password);
  const adminResult = await query(
    `INSERT INTO admin_users (branch_id, full_name, email, password_hash, role, status)
     VALUES (?, ?, ?, ?, 'staff', 'active')`,
    [branchId, "Leads Test Admin", email, passwordHash]
  );
  const adminId = adminResult.insertId;

  const roleKey = `test_leads_${RUN}_${adminId}`;
  const roleResult = await query(`INSERT INTO roles (key_name, display_name, is_system, is_active) VALUES (?, ?, 0, 1)`, [
    roleKey,
    "Leads Test Role"
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

async function createFixtureLead(overrides = {}) {
  const suffix = `${RUN}-${ctx.messageIds.length}-${Math.random().toString(36).slice(2, 6)}`;
  const message = await messageRepository.createMessage({
    name: overrides.name || `Lead Tester ${suffix}`,
    email: overrides.email || `lead.${suffix}@test.local`,
    phone: overrides.phone || nextPhone(),
    subject: overrides.subject || `Fixture lead ${suffix}`,
    message: "Interested in a trial membership.",
    ipAddress: "127.0.0.1"
  });
  ctx.messageIds.push(message.id);
  return message;
}

test.before(async () => {
  if (noDb) return;

  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const branches = await query("SELECT id, code FROM branches WHERE code = 'main'");
  const main = branches[0];
  if (!main) {
    return; // Main branch row missing on this DB -- individual tests no-op.
  }
  ctx.mainBranchId = main.id;

  ctx.adminPassword = "LeadsAdmin@123";
  ctx.leadsAdminEmail = `leadsadmin.${RUN}@test.local`;
  ctx.messagesOnlyEmail = `messagesonly.${RUN}@test.local`;
  ctx.readOnlyEmail = `leadsreadonly.${RUN}@test.local`;
  ctx.noAccessEmail = `leadsnoaccess.${RUN}@test.local`;

  const leadsAdmin = await createScopedAdmin(
    main.id,
    ctx.leadsAdminEmail,
    ["dashboard:read", "leads:read", "leads:write", "messages:write"],
    ctx.adminPassword
  );
  const messagesOnlyAdmin = await createScopedAdmin(main.id, ctx.messagesOnlyEmail, ["dashboard:read", "messages:write"], ctx.adminPassword);
  const readOnlyAdmin = await createScopedAdmin(main.id, ctx.readOnlyEmail, ["dashboard:read", "leads:read"], ctx.adminPassword);
  const noAccessAdmin = await createScopedAdmin(main.id, ctx.noAccessEmail, ["dashboard:read"], ctx.adminPassword);

  ctx.leadsAdminId = leadsAdmin.adminId;
  ctx.leadsAdminRoleKey = leadsAdmin.roleKey;
  ctx.messagesOnlyAdminId = messagesOnlyAdmin.adminId;
  ctx.messagesOnlyRoleKey = messagesOnlyAdmin.roleKey;
  ctx.readOnlyAdminId = readOnlyAdmin.adminId;
  ctx.readOnlyRoleKey = readOnlyAdmin.roleKey;
  ctx.noAccessAdminId = noAccessAdmin.adminId;
  ctx.noAccessRoleKey = noAccessAdmin.roleKey;

  const [leadsLogin, messagesOnlyLogin, readOnlyLogin, noAccessLogin] = await Promise.all([
    api("POST", "/api/v1/admin/auth/login", { body: { identifier: ctx.leadsAdminEmail, password: ctx.adminPassword } }),
    api("POST", "/api/v1/admin/auth/login", { body: { identifier: ctx.messagesOnlyEmail, password: ctx.adminPassword } }),
    api("POST", "/api/v1/admin/auth/login", { body: { identifier: ctx.readOnlyEmail, password: ctx.adminPassword } }),
    api("POST", "/api/v1/admin/auth/login", { body: { identifier: ctx.noAccessEmail, password: ctx.adminPassword } })
  ]);
  assert.equal(leadsLogin.status, 200, "setup: leads admin login must succeed");
  assert.equal(messagesOnlyLogin.status, 200, "setup: messages-only admin login must succeed");
  assert.equal(readOnlyLogin.status, 200, "setup: leads-read-only admin login must succeed");
  assert.equal(noAccessLogin.status, 200, "setup: no-access admin login must succeed");
  ctx.leadsAdminToken = leadsLogin.json.data.accessToken;
  ctx.messagesOnlyToken = messagesOnlyLogin.json.data.accessToken;
  ctx.readOnlyToken = readOnlyLogin.json.data.accessToken;
  ctx.noAccessToken = noAccessLogin.json.data.accessToken;

  ctx.ready = true;
});

test.after(async () => {
  if (noDb) return;

  const tryDelete = async (label, sql, params) => {
    try {
      await query(sql, params);
    } catch (error) {
      console.error(`[leads.test.js cleanup] ${label} failed:`, error.code || error.message);
    }
  };

  if (ctx.messageIds.length) {
    const placeholders = ctx.messageIds.map(() => "?").join(",");
    await tryDelete("lead_notes", `DELETE FROM lead_notes WHERE message_id IN (${placeholders})`, ctx.messageIds);
    await tryDelete("messages (fixtures)", `DELETE FROM messages WHERE id IN (${placeholders})`, ctx.messageIds);
  }
  // The spam-protection test's real HTTP submission (if it got far enough to
  // insert) isn't tracked by id -- clean it up by its distinctive subject.
  await tryDelete("messages (honeypot test)", "DELETE FROM messages WHERE subject LIKE ?", [`%${RUN}%`]);

  if (ctx.userIds.length) {
    const placeholders = ctx.userIds.map(() => "?").join(",");
    await tryDelete("users (converted)", `DELETE FROM users WHERE id IN (${placeholders})`, ctx.userIds);
  }

  await tryDelete("roles", "DELETE FROM roles WHERE key_name IN (?, ?, ?, ?)", [
    ctx.leadsAdminRoleKey ?? "",
    ctx.messagesOnlyRoleKey ?? "",
    ctx.readOnlyRoleKey ?? "",
    ctx.noAccessRoleKey ?? ""
  ]);
  await tryDelete("admin_users", "DELETE FROM admin_users WHERE id IN (?, ?, ?, ?)", [
    ctx.leadsAdminId ?? 0,
    ctx.messagesOnlyAdminId ?? 0,
    ctx.readOnlyAdminId ?? 0,
    ctx.noAccessAdminId ?? 0
  ]);

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  const pool = getPool();
  if (pool) {
    await pool.end();
  }
});

test("list/filter: leadStatus and assignedTo filters, and the list route accepts either messages:write or leads:read", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const leadA = await createFixtureLead();
  const leadB = await createFixtureLead();
  const leadC = await createFixtureLead();

  const assign = await api("PATCH", `/api/v1/messages/${leadA.id}/lead`, {
    token: ctx.leadsAdminToken,
    body: { leadStatus: "contacted", assignedTo: ctx.leadsAdminId }
  });
  assert.equal(assign.status, 200);
  assert.equal(assign.json.data.leadStatus, "contacted");
  assert.equal(assign.json.data.assignedTo, ctx.leadsAdminId);

  const filtered = await api(
    "GET",
    `/api/v1/messages?leadStatus=contacted&assignedTo=${ctx.leadsAdminId}`,
    { token: ctx.leadsAdminToken }
  );
  assert.equal(filtered.status, 200);
  assert.ok(filtered.json.data.pagination, "response must be the paginated { items, pagination } shape");
  assert.ok(filtered.json.data.items.some((item) => item.id === leadA.id), "leadA must appear in the contacted+assigned filter");
  assert.ok(!filtered.json.data.items.some((item) => item.id === leadB.id), "leadB (still new/unassigned) must not appear");

  const newOnly = await api("GET", "/api/v1/messages?leadStatus=new", { token: ctx.leadsAdminToken });
  assert.equal(newOnly.status, 200);
  assert.ok(newOnly.json.data.items.some((item) => item.id === leadB.id));
  assert.ok(newOnly.json.data.items.some((item) => item.id === leadC.id));
  assert.ok(!newOnly.json.data.items.some((item) => item.id === leadA.id), "leadA is no longer 'new'");

  // requireAnyPermission OR-gate: a leads:read-only admin (no messages:write)
  // must still be able to reach the list -- e.g. the "marketing" role in
  // src/security/permissions.js has leads:read but not messages:write.
  const readOnlyList = await api("GET", "/api/v1/messages", { token: ctx.readOnlyToken });
  assert.equal(readOnlyList.status, 200, "leads:read alone must be enough to view the list");

  // An admin with neither permission must be rejected.
  const noAccessList = await api("GET", "/api/v1/messages", { token: ctx.noAccessToken });
  assert.equal(noAccessList.status, 403);
});

test("lead pipeline write (lead_status/assigned_to) requires leads:write, not just messages:write", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const lead = await createFixtureLead();

  const deniedForMessagesOnly = await api("PATCH", `/api/v1/messages/${lead.id}/lead`, {
    token: ctx.messagesOnlyToken,
    body: { leadStatus: "contacted" }
  });
  assert.equal(deniedForMessagesOnly.status, 403, "messages:write alone must not be able to write CRM pipeline fields");

  const invalidStatus = await api("PATCH", `/api/v1/messages/${lead.id}/lead`, {
    token: ctx.leadsAdminToken,
    body: { leadStatus: "not-a-real-status" }
  });
  assert.equal(invalidStatus.status, 422);

  const update = await api("PATCH", `/api/v1/messages/${lead.id}/lead`, {
    token: ctx.leadsAdminToken,
    body: { leadStatus: "rejected", assignedTo: ctx.leadsAdminId }
  });
  assert.equal(update.status, 200);
  assert.equal(update.json.data.leadStatus, "rejected");
  assert.equal(update.json.data.assignedTo, ctx.leadsAdminId);

  // Unassign: explicit null must clear assigned_to, not be ignored.
  const unassign = await api("PATCH", `/api/v1/messages/${lead.id}/lead`, {
    token: ctx.leadsAdminToken,
    body: { assignedTo: null }
  });
  assert.equal(unassign.status, 200);
  assert.equal(unassign.json.data.assignedTo, null);
  assert.equal(unassign.json.data.leadStatus, "rejected", "omitted leadStatus field must be left untouched");

  // The plain-inbox route (status only) must be unaffected by any of this --
  // messages:write alone is still enough for the existing inbox actions.
  const plainUpdate = await api("PUT", `/api/v1/messages/${lead.id}`, {
    token: ctx.messagesOnlyToken,
    body: { status: "read" }
  });
  assert.equal(plainUpdate.status, 200, "plain inbox status update must remain reachable with only messages:write");
});

test("lead follow-up notes: add (leads:write) and view (leads:read or leads:write)", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const lead = await createFixtureLead();

  const deniedAdd = await api("POST", `/api/v1/messages/${lead.id}/notes`, {
    token: ctx.messagesOnlyToken,
    body: { note: "Should be rejected" }
  });
  assert.equal(deniedAdd.status, 403, "adding a note requires leads:write");

  const deniedView = await api("GET", `/api/v1/messages/${lead.id}/notes`, { token: ctx.messagesOnlyToken });
  assert.equal(deniedView.status, 403, "viewing notes requires leads:read or leads:write, not messages:write alone");

  const add = await api("POST", `/api/v1/messages/${lead.id}/notes`, {
    token: ctx.leadsAdminToken,
    body: { note: `Called and left a voicemail. ${RUN}` }
  });
  assert.equal(add.status, 201);
  assert.match(add.json.data.note, new RegExp(RUN));
  assert.equal(add.json.data.createdBy, ctx.leadsAdminId);

  const listAsReadOnly = await api("GET", `/api/v1/messages/${lead.id}/notes`, { token: ctx.readOnlyToken });
  assert.equal(listAsReadOnly.status, 200, "leads:read alone must be able to view notes");
  assert.ok(listAsReadOnly.json.data.some((note) => note.id === add.json.data.id));

  const missing = await api("GET", "/api/v1/messages/99999999/notes", { token: ctx.leadsAdminToken });
  assert.equal(missing.status, 404);
});

test("convert lead to member: happy path, then a second convert on the same lead is rejected", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const lead = await createFixtureLead({ name: "Convert Me", email: `convert.${RUN}@test.local`, phone: nextPhone() });

  const convert = await api("POST", `/api/v1/messages/${lead.id}/convert`, { token: ctx.leadsAdminToken, body: {} });
  assert.equal(convert.status, 201);
  assert.ok(convert.json.data.userId, "convert must return the new member's user id");
  ctx.userIds.push(convert.json.data.userId);
  assert.equal(convert.json.data.message.leadStatus, "converted");
  assert.equal(convert.json.data.message.convertedUserId, convert.json.data.userId);

  const userRows = await query("SELECT id, branch_id, full_name, email, phone FROM users WHERE id = ?", [convert.json.data.userId]);
  assert.equal(userRows.length, 1, "a real users row must have been created");
  assert.equal(userRows[0].email, lead.email);
  assert.equal(userRows[0].phone, lead.phone);
  assert.equal(userRows[0].branch_id, ctx.mainBranchId, "a non-switching admin's convert must land in their own home branch");

  const messageRows = await query("SELECT lead_status, converted_user_id FROM messages WHERE id = ?", [lead.id]);
  assert.equal(messageRows[0].lead_status, "converted");
  assert.equal(messageRows[0].converted_user_id, convert.json.data.userId);

  const secondConvert = await api("POST", `/api/v1/messages/${lead.id}/convert`, { token: ctx.leadsAdminToken, body: {} });
  assert.equal(secondConvert.status, 409, "an already-converted lead must not be converted twice");
});

test("convert lead to member: the lead's email/phone already belongs to a member surfaces a clear 409, not a crash", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const email = `dupe.${RUN}@test.local`;
  const phone = nextPhone();

  const firstLead = await createFixtureLead({ name: "First Signup", email, phone });
  const firstConvert = await api("POST", `/api/v1/messages/${firstLead.id}/convert`, { token: ctx.leadsAdminToken, body: {} });
  assert.equal(firstConvert.status, 201);
  ctx.userIds.push(firstConvert.json.data.userId);

  // A second, unrelated lead that happens to share the same email/phone --
  // e.g. the same person filled the contact form again after already
  // becoming a member.
  const secondLead = await createFixtureLead({ name: "Duplicate Signup", email, phone });
  const secondConvert = await api("POST", `/api/v1/messages/${secondLead.id}/convert`, { token: ctx.leadsAdminToken, body: {} });
  assert.equal(secondConvert.status, 409);
  assert.match(secondConvert.json.error, /already exists/i);

  // The failed convert must not have left the second lead in a half-converted state.
  const secondMessageRows = await query("SELECT lead_status, converted_user_id FROM messages WHERE id = ?", [secondLead.id]);
  assert.equal(secondMessageRows[0].lead_status, "new");
  assert.equal(secondMessageRows[0].converted_user_id, null);

  const deniedConvert = await api("POST", `/api/v1/messages/${secondLead.id}/convert`, { token: ctx.messagesOnlyToken, body: {} });
  assert.equal(deniedConvert.status, 403, "converting requires leads:write");
});

test("public contact form: a filled honeypot is silently discarded, and that request still consumes the per-IP rate limit", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const subject = `Honeypot probe ${RUN}`;
  const honeypot = await api("POST", "/api/v1/messages", {
    body: {
      name: "Spambot",
      email: `spambot.${RUN}@test.local`,
      phone: nextPhone(),
      subject,
      message: "Buy cheap watches now.",
      website: "http://spam.example" // the honeypot field -- a real visitor never fills this
    }
  });
  assert.equal(honeypot.status, 200, "a honeypot submission must not error (would tip off the bot)");
  assert.equal(honeypot.json.data.accepted, true);

  const rows = await query("SELECT id FROM messages WHERE subject = ?", [subject]);
  assert.equal(rows.length, 0, "a honeypot submission must never create a message row");

  // The honeypot request ran through the same contactLimiter middleware as a
  // real submission (limit: 1 per IP per 10 minutes) -- the very next
  // request from this same IP, even a legitimate one, must now be rejected.
  const secondSubject = `Real submission after honeypot ${RUN}`;
  const realSubmission = await api("POST", "/api/v1/messages", {
    body: {
      name: "Real Visitor",
      email: `realvisitor.${RUN}@test.local`,
      phone: nextPhone(),
      subject: secondSubject,
      message: "I would like to know more about membership plans."
    }
  });
  assert.equal(realSubmission.status, 429, "the rate limit must trigger on the next request from the same IP");
  assert.equal(realSubmission.json.success, false);

  const secondRows = await query("SELECT id FROM messages WHERE subject = ?", [secondSubject]);
  assert.equal(secondRows.length, 0, "the rate-limited request must not have created a row either");
});
