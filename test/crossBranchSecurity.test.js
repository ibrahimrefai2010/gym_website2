// Full cross-branch security suite for Part 1 (Women's Branch) -- this is the
// feature's actual definition of done, not just the by-id ownership fix.
// Runs the real Express app (src/app.js) on an ephemeral local port and
// drives it with plain fetch(), so every assertion goes through the real
// middleware chain (auth, attachEffectiveBranch, RBAC, branch resolution) --
// not just the repository/service layer directly. Self-skips entirely
// without DB config, matching this repo's other *.test.js files; within the
// suite, an early `if (!ctx.ready) return;` no-ops individual tests if a
// required fixture (the Women's branch row, itself added by this feature's
// own migration) isn't present, mirroring the same "return early" idiom
// test/invoiceNumbering.test.js and test/branchAccess.test.js already use.
//
// Covers the 8 numbered scenarios from the phase brief:
//   1. Same-email users in different branches never see/affect each other's
//      /api/v1/user/* data.
//   2. POST /api/v1/memberships/buy rejects a cross-branch plan (via the
//      route, not just membershipRepository.buy directly -- that's already
//      covered by test/branchAccess.test.js).
//   3. A spoofed branchId in the request body/query has no effect, on
//      registration and on admin customer create/list.
//   4. List-level AND by-id branch isolation for customers/memberships/
//      plans/offers/invoices/payments.
//   5. A same-email Men's-branch OTP cannot authenticate the Women's-branch
//      account.
//   6. (not duplicated here -- see test/branchAccess.test.js:35-39, "a
//      non-switching admin's spoofed X-View-Branch header has zero effect",
//      already proves this.)
//   7. (not duplicated here -- see test/invoiceNumbering.test.js, already
//      proves gap-free per-branch invoice sequences.)
//   8. Main/Men's branch flows unaffected + no-signal bootstrap fallback.

const test = require("node:test");
const assert = require("node:assert/strict");
const { hasDatabaseConfig, query, getPool } = require("../src/config/database");
const app = require("../src/app");
const userRepository = require("../src/repositories/userRepository");
const planRepository = require("../src/repositories/planRepository");
const offerRepository = require("../src/repositories/offerRepository");
const membershipRepository = require("../src/repositories/membershipRepository");
const invoiceRepository = require("../src/repositories/invoiceRepository");
const businessSettingsRepository = require("../src/repositories/businessSettingsRepository");
const tokenRepository = require("../src/repositories/tokenRepository");
const { hashPassword } = require("../src/utils/hash");

const noDb = !hasDatabaseConfig();
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

let server;
let baseUrl;
const ctx = { ready: false };

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
    [branchId, "Cross Branch Test Admin", email, passwordHash]
  );
  const adminId = adminResult.insertId;

  // A dedicated RBAC role per test admin (not one of the seeded default
  // roles) so this suite's permission set is exact and independent of
  // whatever default roles happen to be configured on this DB, and so
  // branches:manage is guaranteed absent -- these must be non-switching
  // admins for the by-id ownership checks to mean anything.
  const roleKey = `test_cbs_${RUN}_${adminId}`;
  const roleResult = await query(
    `INSERT INTO roles (key_name, display_name, is_system, is_active) VALUES (?, ?, 0, 1)`,
    [roleKey, "Cross Branch Security Test Role"]
  );
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

const SCOPED_ADMIN_PERMISSIONS = [
  "dashboard:read",
  "customers:manage",
  "memberships:read",
  "memberships:write",
  "plans:write",
  "offers:write",
  "invoices:read",
  "invoices:write",
  "payments:write"
];

async function ensureVatConfigured(branchId, fallback) {
  const original = await businessSettingsRepository.get(branchId);
  if (original && /^\d{15}$/.test(String(original.vatNumber || ""))) {
    return { changed: false };
  }
  await businessSettingsRepository.update(fallback, null, branchId);
  return { changed: true, original };
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

  ctx.womenVat = await ensureVatConfigured(women.id, {
    vatNumber: "310160591300088",
    legalEntityNameEn: "Test Women Branch",
    legalEntityNameAr: "فرع نسائي تجريبي"
  });
  ctx.mainVat = await ensureVatConfigured(main.id, {
    vatNumber: "310160591300077",
    legalEntityNameEn: "Test Main Branch",
    legalEntityNameAr: "فرع رئيسي تجريبي"
  });

  // --- Scenario 1 fixtures: same email, independent accounts per branch. ---
  ctx.sharedEmail = `crossbranch.${RUN}@test.local`;
  ctx.mainUserPassword = "MainUser@123";
  ctx.womenUserPassword = "WomenUser@123";
  // Goes through userRepository.createUser -- the exact function
  // authService.register calls -- so this is the same code path a real
  // registration exercises, without spending the HTTP register rate limit
  // (5/hour) across repeated local test runs.
  const mainUser = await userRepository.createUser({
    branchId: main.id,
    fullName: "Main CrossBranch User",
    email: ctx.sharedEmail,
    phone: nextPhone(),
    password: ctx.mainUserPassword
  });
  const womenUser = await userRepository.createUser({
    branchId: women.id,
    fullName: "Women CrossBranch User",
    email: ctx.sharedEmail,
    phone: nextPhone(),
    password: ctx.womenUserPassword
  });
  assert.ok(mainUser && womenUser, "setup: the same email must create two independent accounts, one per branch");
  ctx.mainUserId = mainUser.id;
  ctx.womenUserId = womenUser.id;

  // --- Plan / offer fixtures (one pair for update-ownership tests, one pair
  // dedicated to delete-ownership tests so the two don't interfere). ---
  const planPayload = (branchId, label) => ({
    nameEn: `${label} Test Plan ${RUN}`,
    nameAr: `خطة تجريبية ${RUN}`,
    descriptionEn: "Test plan",
    descriptionAr: "خطة تجريبية",
    durationDays: 30,
    price: 100,
    branchId
  });
  ctx.mainPlan = await planRepository.savePlan(planPayload(main.id, "Main"));
  ctx.womenPlan = await planRepository.savePlan(planPayload(women.id, "Women"));
  ctx.mainPlanForDelete = await planRepository.savePlan(planPayload(main.id, "MainDelete"));
  ctx.womenPlanForDelete = await planRepository.savePlan(planPayload(women.id, "WomenDelete"));

  const offerPayload = (branchId, label) => ({
    titleEn: `${label} Test Offer ${RUN}`,
    titleAr: `عرض تجريبي ${RUN}`,
    bodyEn: "Test offer",
    bodyAr: "عرض تجريبي",
    // MySQL DATETIME wants 'YYYY-MM-DD HH:MM:SS', not raw ISO 8601 -- reuse
    // this repo's existing date-formatting convention (see
    // tokenRepository.utcDateFromNow / invoiceRepository.js:260) rather than
    // a bare .toISOString(), which MySQL rejects with ER_TRUNCATED_WRONG_VALUE.
    expiresAt: tokenRepository.utcDateFromNow(30 * 24 * 60 * 60 * 1000),
    branchId
  });
  ctx.mainOffer = await offerRepository.saveOffer(offerPayload(main.id, "Main"));
  ctx.womenOffer = await offerRepository.saveOffer(offerPayload(women.id, "Women"));

  // --- Membership + payment fixtures (also exercises scenario 2's route,
  // indirectly, by proving the correct-branch purchase succeeds). ---
  const mainPurchase = await membershipRepository.buy({ userId: mainUser.id, planId: ctx.mainPlan.id });
  ctx.mainMembershipId = mainPurchase.membership.id;
  ctx.mainPaymentId = mainPurchase.payment.id;
  const womenPurchase = await membershipRepository.buy({ userId: womenUser.id, planId: ctx.womenPlan.id });
  ctx.womenMembershipId = womenPurchase.membership.id;
  ctx.womenPaymentId = womenPurchase.payment.id;

  // --- Invoice fixtures. ---
  const item = { description: "Test line", quantity: 1, unitPrice: 100, taxRate: 15, itemType: "other" };
  const mainInvoice = await invoiceRepository.createInvoice({ userId: mainUser.id, branchId: main.id, items: [item] });
  ctx.mainInvoiceId = mainInvoice.id;
  const womenInvoice = await invoiceRepository.createInvoice({ userId: womenUser.id, branchId: women.id, items: [item] });
  ctx.womenInvoiceId = womenInvoice.id;

  // --- Scoped (non-switching) admin fixtures, one per branch. ---
  ctx.adminPassword = "ScopedAdmin@123";
  ctx.mainAdminEmail = `mainadmin.${RUN}@test.local`;
  ctx.womenAdminEmail = `womenadmin.${RUN}@test.local`;
  const mainAdmin = await createScopedAdmin(main.id, ctx.mainAdminEmail, SCOPED_ADMIN_PERMISSIONS, ctx.adminPassword);
  const womenAdmin = await createScopedAdmin(women.id, ctx.womenAdminEmail, SCOPED_ADMIN_PERMISSIONS, ctx.adminPassword);
  ctx.mainAdminId = mainAdmin.adminId;
  ctx.mainAdminRoleKey = mainAdmin.roleKey;
  ctx.womenAdminId = womenAdmin.adminId;
  ctx.womenAdminRoleKey = womenAdmin.roleKey;

  // --- Log everyone in once via the real HTTP routes; reused across tests
  // to stay well under the login rate limit (10/15min). ---
  const mainUserLogin = await api("POST", "/api/v1/auth/login", {
    body: { identifier: ctx.sharedEmail, password: ctx.mainUserPassword },
    headers: { "X-Branch": "main" }
  });
  const womenUserLogin = await api("POST", "/api/v1/auth/login", {
    body: { identifier: ctx.sharedEmail, password: ctx.womenUserPassword },
    headers: { "X-Branch": "women" }
  });
  const mainAdminLogin = await api("POST", "/api/v1/admin/auth/login", {
    body: { identifier: ctx.mainAdminEmail, password: ctx.adminPassword }
  });
  const womenAdminLogin = await api("POST", "/api/v1/admin/auth/login", {
    body: { identifier: ctx.womenAdminEmail, password: ctx.adminPassword }
  });
  assert.equal(mainUserLogin.status, 200, "setup: Main user login must succeed");
  assert.equal(womenUserLogin.status, 200, "setup: Women's user login must succeed");
  assert.equal(mainAdminLogin.status, 200, "setup: Main admin login must succeed");
  assert.equal(womenAdminLogin.status, 200, "setup: Women's admin login must succeed");
  ctx.mainUserToken = mainUserLogin.json.data.accessToken;
  ctx.womenUserToken = womenUserLogin.json.data.accessToken;
  ctx.mainAdminToken = mainAdminLogin.json.data.accessToken;
  ctx.womenAdminToken = womenAdminLogin.json.data.accessToken;

  ctx.ready = true;
});

test.after(async () => {
  if (noDb) return;

  // Not gated behind ctx.ready -- if test.before threw partway through (as
  // it did while the offer-fixture datetime bug was still present), several
  // rows can already exist even though ctx.ready never got set. Every field
  // read below is optional-chained, so this is safe to run unconditionally
  // and cleans up whatever actually got created, not just the happy path.
  const tryDelete = async (label, sql, params) => {
    try {
      await query(sql, params);
    } catch (error) {
      // Best-effort cleanup, but NOT silent -- a swallowed error here is
      // exactly how test fixtures end up permanently orphaned in the shared
      // dev DB (which happened: an earlier run of this suite left users/
      // plans behind because this used to catch-and-ignore with no trace).
      console.error(`[crossBranchSecurity.test.js cleanup] ${label} failed:`, error.code || error.message);
    }
  };

  await tryDelete("invoice_items", "DELETE FROM invoice_items WHERE invoice_id IN (?, ?)", [ctx.mainInvoiceId, ctx.womenInvoiceId]);
  await tryDelete("invoices", "DELETE FROM invoices WHERE id IN (?, ?)", [ctx.mainInvoiceId, ctx.womenInvoiceId]);
  await tryDelete("payments", "DELETE FROM payments WHERE id IN (?, ?)", [ctx.mainPaymentId, ctx.womenPaymentId]);
  await tryDelete("memberships", "DELETE FROM memberships WHERE id IN (?, ?)", [ctx.mainMembershipId, ctx.womenMembershipId]);
  await tryDelete("plans", "DELETE FROM plans WHERE id IN (?, ?, ?, ?)", [
    ctx.mainPlan?.id,
    ctx.womenPlan?.id,
    ctx.mainPlanForDelete?.id,
    ctx.womenPlanForDelete?.id
  ]);
  await tryDelete("offers", "DELETE FROM offers WHERE id IN (?, ?)", [ctx.mainOffer?.id, ctx.womenOffer?.id]);
  await tryDelete("otp_tokens", "DELETE FROM otp_tokens WHERE identifier = ?", [ctx.sharedEmail]);
  // No explicit refresh_tokens cleanup needed -- both its user_id and
  // admin_user_id columns are ON DELETE CASCADE (see src/db/schema.sql),
  // so deleting the users/admin_users rows below already takes care of it.
  await tryDelete("users", "DELETE FROM users WHERE id IN (?, ?)", [ctx.mainUserId, ctx.womenUserId]);
  await tryDelete("roles", "DELETE FROM roles WHERE key_name IN (?, ?)", [ctx.mainAdminRoleKey, ctx.womenAdminRoleKey]);
  await tryDelete("admin_users", "DELETE FROM admin_users WHERE id IN (?, ?)", [ctx.mainAdminId, ctx.womenAdminId]);

  if (ctx.womenVat?.changed) {
    await businessSettingsRepository
      .update(
        {
          vatNumber: ctx.womenVat.original?.vatNumber || "",
          legalEntityNameEn: ctx.womenVat.original?.legalEntityNameEn || "",
          legalEntityNameAr: ctx.womenVat.original?.legalEntityNameAr || ""
        },
        null,
        ctx.womenBranchId
      )
      .catch((error) => console.error("[crossBranchSecurity.test.js cleanup] Women's VAT restore failed:", error.message));
  }
  if (ctx.mainVat?.changed) {
    await businessSettingsRepository
      .update(
        {
          vatNumber: ctx.mainVat.original?.vatNumber || "",
          legalEntityNameEn: ctx.mainVat.original?.legalEntityNameEn || "",
          legalEntityNameAr: ctx.mainVat.original?.legalEntityNameAr || ""
        },
        null,
        ctx.mainBranchId
      )
      .catch((error) => console.error("[crossBranchSecurity.test.js cleanup] Main VAT restore failed:", error.message));
  }

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  const pool = getPool();
  if (pool) await pool.end();
});

// --- Scenario 1: same-email cross-branch session isolation. ---

test("scenario 1: a Main-branch user's session cannot see the Women's-branch account sharing its email, and vice versa", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const mainMe = await api("GET", "/api/v1/user/me", { token: ctx.mainUserToken });
  const womenMe = await api("GET", "/api/v1/user/me", { token: ctx.womenUserToken });

  assert.equal(mainMe.status, 200);
  assert.equal(womenMe.status, 200);
  assert.equal(mainMe.json.data.id, ctx.mainUserId);
  assert.equal(womenMe.json.data.id, ctx.womenUserId);
  assert.notEqual(mainMe.json.data.id, womenMe.json.data.id, "same email must resolve to two distinct accounts");
  assert.equal(mainMe.json.data.email, ctx.sharedEmail);
  assert.equal(womenMe.json.data.email, ctx.sharedEmail);

  // Writing through one session must never affect the other account's row.
  const rename = await api("PATCH", "/api/v1/user/profile", {
    token: ctx.mainUserToken,
    body: { fullName: "Renamed Main User" }
  });
  assert.equal(rename.status, 200);

  const womenMeAfter = await api("GET", "/api/v1/user/me", { token: ctx.womenUserToken });
  assert.notEqual(womenMeAfter.json.data.fullName, "Renamed Main User", "Women's account must be untouched by the Main session's write");

  const mainDashboard = await api("GET", "/api/v1/user/dashboard", { token: ctx.mainUserToken });
  const womenDashboard = await api("GET", "/api/v1/user/dashboard", { token: ctx.womenUserToken });
  assert.equal(mainDashboard.status, 200);
  assert.equal(womenDashboard.status, 200);
  // /api/v1/user/dashboard is actually served by memberController.dashboard
  // (memberRoutes is mounted at /api/v1/user ahead of userRoutes in app.js,
  // and both define a /dashboard route -- memberRoutes wins), whose shape is
  // { member: {...}, ... }, not { user: {...} }. See
  // src/services/memberPortalService.js:132-149.
  assert.equal(mainDashboard.json.data.member.id, ctx.mainUserId);
  assert.equal(womenDashboard.json.data.member.id, ctx.womenUserId);
});

// --- Scenario 2: purchase route rejects cross-branch plan. ---

test("scenario 2: POST /api/v1/memberships/buy rejects a plan from a different branch than the buyer's own", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const mismatched = await api("POST", "/api/v1/memberships/buy", {
    token: ctx.mainUserToken,
    body: { planId: ctx.womenPlan.id }
  });
  assert.equal(mismatched.status, 409);
  assert.equal(mismatched.json.success, false);

  const reverse = await api("POST", "/api/v1/memberships/buy", {
    token: ctx.womenUserToken,
    body: { planId: ctx.mainPlan.id }
  });
  assert.equal(reverse.status, 409);
});

// --- Scenario 3: spoofed branch in body/query has no effect. ---

test("scenario 3a: a spoofed branchId in the registration body is ignored -- the subdomain/header resolves it", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const email = `spoofreg.${RUN}@test.local`;
  const res = await api("POST", "/api/v1/auth/register", {
    body: {
      fullName: "Spoof Branch Register",
      email,
      phone: nextPhone(),
      password: "SpoofTest@123",
      branchId: ctx.mainBranchId // spoofed -- request arrives on the Women's branch
    },
    headers: { "X-Branch": "women" }
  });
  assert.equal(res.status, 201);

  try {
    const rows = await query("SELECT branch_id FROM users WHERE email = ? AND branch_id = ? LIMIT 1", [
      email,
      ctx.womenBranchId
    ]);
    assert.ok(rows[0], "the account must land on the Women's branch (from the header), not branch_id from the spoofed body field");
  } finally {
    await query("DELETE FROM users WHERE email = ?", [email]).catch(() => {});
  }
});

test("scenario 3b: a spoofed branchId in an admin customer-create body is ignored -- the admin's own branch always wins", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const email = `spoofcustomer.${RUN}@test.local`;
  const res = await api("POST", "/api/v1/customers", {
    token: ctx.womenAdminToken, // Women's-branch-scoped admin
    body: {
      fullName: "Spoof Branch Customer",
      email,
      phone: nextPhone(),
      branchId: ctx.mainBranchId // spoofed -- trying to plant a customer on Main
    }
  });
  assert.equal(res.status, 201);
  const created = await query("SELECT branch_id FROM users WHERE id = ? LIMIT 1", [res.json.data.id]);
  assert.equal(created[0]?.branch_id, ctx.womenBranchId, "the new customer must be created in the admin's own branch, never the spoofed body value");

  await query("DELETE FROM customer_profiles WHERE user_id = ?", [res.json.data.id]).catch(() => {});
  await query("DELETE FROM users WHERE id = ?", [res.json.data.id]).catch(() => {});
});

test("scenario 3c: a spoofed ?branchId= query param on the admin invoice list has no effect", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const res = await api("GET", `/api/v1/invoices?branchId=${ctx.mainBranchId}`, { token: ctx.womenAdminToken });
  assert.equal(res.status, 200);
  const ids = res.json.data.items.map((row) => row.id);
  assert.ok(!ids.includes(ctx.mainInvoiceId), "Women's-branch admin must never see the Main invoice, even via a spoofed query param");
});

// --- Scenario 4: list-level and by-id branch isolation. ---

test("scenario 4a (list-level, lock-in): a branch-scoped admin's customer/membership/invoice lists never include the other branch", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const customers = await api("GET", "/api/v1/customers", { token: ctx.womenAdminToken });
  assert.equal(customers.status, 200);
  assert.ok(
    !customers.json.data.items.some((row) => row.id === ctx.mainUserId),
    "Women's-branch admin's customer list must not include the Main-branch user"
  );

  const memberships = await api("GET", "/api/v1/memberships", { token: ctx.womenAdminToken });
  assert.equal(memberships.status, 200);
  assert.ok(
    !memberships.json.data.some((row) => row.id === ctx.mainMembershipId),
    "Women's-branch admin's membership list must not include the Main-branch membership"
  );

  const invoices = await api("GET", "/api/v1/invoices", { token: ctx.mainAdminToken });
  assert.equal(invoices.status, 200);
  assert.ok(
    !invoices.json.data.items.some((row) => row.id === ctx.womenInvoiceId),
    "Main-branch admin's invoice list must not include the Women's-branch invoice"
  );
});

test("scenario 4b (by-id, Part A's fix): a branch-scoped admin gets 404 -- not the data -- for another branch's customer by id", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const crossBranch = await api("GET", `/api/v1/customers/${ctx.mainUserId}`, { token: ctx.womenAdminToken });
  assert.equal(crossBranch.status, 404);
  assert.equal(crossBranch.json.data, undefined);

  const crossBranchUpdate = await api("PUT", `/api/v1/customers/${ctx.mainUserId}`, {
    token: ctx.womenAdminToken,
    body: { fullName: "Should Not Apply" }
  });
  assert.equal(crossBranchUpdate.status, 404);

  const ownBranch = await api("GET", `/api/v1/customers/${ctx.womenUserId}`, { token: ctx.womenAdminToken });
  assert.equal(ownBranch.status, 200, "positive control: the same admin must still be able to read their own branch's customer");
});

test("scenario 4c (by-id): membership activate/cancel by id is branch-checked, not just listable", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const crossActivate = await api("PATCH", `/api/v1/memberships/${ctx.womenMembershipId}/activate`, {
    token: ctx.mainAdminToken
  });
  assert.equal(crossActivate.status, 404);

  const ownActivate = await api("PATCH", `/api/v1/memberships/${ctx.womenMembershipId}/activate`, {
    token: ctx.womenAdminToken
  });
  assert.equal(ownActivate.status, 200, "positive control: the owning branch's admin can still activate their own membership");

  const crossCancel = await api("PATCH", `/api/v1/memberships/${ctx.womenMembershipId}/cancel`, {
    token: ctx.mainAdminToken
  });
  assert.equal(crossCancel.status, 404);

  const ownCancel = await api("PATCH", `/api/v1/memberships/${ctx.womenMembershipId}/cancel`, {
    token: ctx.womenAdminToken
  });
  assert.equal(ownCancel.status, 200);
});

test("scenario 4d (by-id): plan update/delete by id is branch-checked (the gap this phase's brief specifically flagged)", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const crossUpdate = await api("PUT", `/api/v1/plans/${ctx.womenPlan.id}`, {
    token: ctx.mainAdminToken,
    body: { nameEn: "Hijacked", nameAr: "مخترق", descriptionEn: "d", descriptionAr: "د", durationDays: 30, price: 1 }
  });
  assert.equal(crossUpdate.status, 404);

  const unchanged = await planRepository.getPlan(ctx.womenPlan.id);
  assert.equal(unchanged.name.en, ctx.womenPlan.name.en, "the Women's plan must be completely untouched by the rejected cross-branch update");
  assert.equal(unchanged.branchId, ctx.womenBranchId, "and its branch_id must not have been hijacked to Main");

  const ownUpdate = await api("PUT", `/api/v1/plans/${ctx.womenPlan.id}`, {
    token: ctx.womenAdminToken,
    body: {
      nameEn: "Women Test Plan Updated",
      nameAr: "خطة نسائية محدثة",
      descriptionEn: "d",
      descriptionAr: "د",
      durationDays: 30,
      price: 100
    }
  });
  assert.equal(ownUpdate.status, 200, "positive control: the owning branch's admin can still update their own plan");

  const crossDelete = await api("DELETE", `/api/v1/plans/${ctx.mainPlanForDelete.id}`, { token: ctx.womenAdminToken });
  assert.equal(crossDelete.status, 404);

  const ownDelete = await api("DELETE", `/api/v1/plans/${ctx.womenPlanForDelete.id}`, { token: ctx.womenAdminToken });
  assert.equal(ownDelete.status, 200);
});

test("scenario 4e (by-id): offer update by id is branch-checked", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const crossUpdate = await api("PUT", `/api/v1/offers/${ctx.mainOffer.id}`, {
    token: ctx.womenAdminToken,
    body: {
      titleEn: "Hijacked",
      titleAr: "مخترق",
      bodyEn: "b",
      bodyAr: "ب",
      expiresAt: tokenRepository.utcDateFromNow(1000000)
    }
  });
  assert.equal(crossUpdate.status, 404);

  const ownUpdate = await api("PUT", `/api/v1/offers/${ctx.womenOffer.id}`, {
    token: ctx.womenAdminToken,
    body: {
      titleEn: "Women Test Offer Updated",
      titleAr: "عرض نسائي محدث",
      bodyEn: "b",
      bodyAr: "ب",
      expiresAt: tokenRepository.utcDateFromNow(1000000)
    }
  });
  assert.equal(ownUpdate.status, 200);
});

test("scenario 4f (by-id): invoice detail/status/pdf by id is branch-checked", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const crossDetail = await api("GET", `/api/v1/invoices/${ctx.womenInvoiceId}`, { token: ctx.mainAdminToken });
  assert.equal(crossDetail.status, 404);

  const crossStatus = await api("PATCH", `/api/v1/invoices/${ctx.womenInvoiceId}/status`, {
    token: ctx.mainAdminToken,
    body: { status: "paid" }
  });
  assert.equal(crossStatus.status, 404);

  const ownDetail = await api("GET", `/api/v1/invoices/${ctx.womenInvoiceId}`, { token: ctx.womenAdminToken });
  assert.equal(ownDetail.status, 200, "positive control: the owning branch's admin can still read their own invoice");
});

test("scenario 4g (by-id): payment complete by id is branch-checked", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const crossComplete = await api("PATCH", `/api/v1/payments/${ctx.womenPaymentId}/complete`, {
    token: ctx.mainAdminToken
  });
  assert.equal(crossComplete.status, 404);

  const ownComplete = await api("PATCH", `/api/v1/payments/${ctx.womenPaymentId}/complete`, {
    token: ctx.womenAdminToken
  });
  assert.equal(ownComplete.status, 200, "positive control: the owning branch's admin can still complete their own payment");
});

// --- Scenario 5: OTP is branch-scoped, even for a shared email. ---

test("scenario 5: an OTP issued for the Main-branch account cannot verify the Women's-branch account sharing its email", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const otp = "482913";
  await tokenRepository.storeOtp({
    identifier: ctx.sharedEmail,
    branchId: ctx.mainBranchId,
    otp,
    purpose: "reset_password",
    expiresAt: tokenRepository.utcDateFromNow(10 * 60 * 1000)
  });

  try {
    const wrongBranch = await api("POST", "/api/v1/auth/verify-otp", {
      body: { identifier: ctx.sharedEmail, otp },
      headers: { "X-Branch": "women" }
    });
    assert.equal(wrongBranch.status, 401, "the Women's-branch account must not be verifiable with the Main-branch account's OTP");
    assert.equal(wrongBranch.json.data, undefined);

    const rightBranch = await api("POST", "/api/v1/auth/verify-otp", {
      body: { identifier: ctx.sharedEmail, otp },
      headers: { "X-Branch": "main" }
    });
    assert.equal(rightBranch.status, 200, "positive control: the same OTP must still work for the Main-branch account it was actually issued to");
    assert.ok(rightBranch.json.data.reset_token);
  } finally {
    await query("DELETE FROM otp_tokens WHERE identifier = ? AND branch_id = ?", [ctx.sharedEmail, ctx.mainBranchId]).catch(() => {});
  }
});

// --- Scenario 8: Main branch unaffected + no-signal fallback. ---

test("scenario 8a: bootstrap with zero branch signals resolves to Main (id 1), same as an explicit main request", { skip: noDb }, async () => {
  const noSignal = await api("GET", "/api/v1/public/bootstrap");
  const explicitMain = await api("GET", "/api/v1/public/bootstrap", { headers: { "X-Branch": "main" } });

  assert.equal(noSignal.status, 200);
  assert.deepEqual(noSignal.json.data.plans, explicitMain.json.data.plans, "no signal at all must resolve identically to an explicit Main request");

  if (ctx.ready) {
    const explicitWomen = await api("GET", "/api/v1/public/bootstrap", { headers: { "X-Branch": "women" } });
    assert.notDeepEqual(
      noSignal.json.data.plans,
      explicitWomen.json.data.plans,
      "sanity check: branch selection must actually change bootstrap output (else the equality above would be vacuous)"
    );
    for (const plan of noSignal.json.data.plans) {
      if (plan.branchId != null) {
        assert.equal(plan.branchId, 1, "every plan in the no-signal bootstrap must belong to branch id 1 (Main)");
      }
    }
  }
});

test("scenario 8b: registration, login, plan listing, membership purchase, and admin dashboard all still work for the Main branch", { skip: noDb }, async () => {
  if (!ctx.ready) return;

  const email = `mainflow.${RUN}@test.local`;
  const password = "MainFlow@123";

  const register = await api("POST", "/api/v1/auth/register", {
    body: { fullName: "Main Flow User", email, phone: nextPhone(), password }
    // No X-Branch header at all -- exercises the same no-signal path as 8a.
  });
  assert.equal(register.status, 201);
  const userId = register.json.data.user.id;

  try {
    const login = await api("POST", "/api/v1/auth/login", { body: { identifier: email, password } });
    assert.equal(login.status, 200);
    const userToken = login.json.data.accessToken;

    const plans = await api("GET", "/api/v1/plans");
    assert.equal(plans.status, 200);
    assert.ok(Array.isArray(plans.json.data));

    const buy = await api("POST", "/api/v1/memberships/buy", { token: userToken, body: { planId: ctx.mainPlan.id } });
    assert.equal(buy.status, 201, "membership purchase must still work end-to-end for the Main branch");

    const dashboard = await api("GET", "/api/v1/admin/overview", { token: ctx.mainAdminToken });
    assert.equal(dashboard.status, 200, "Main-branch admin dashboard must still work");

    await query("DELETE FROM payments WHERE id = ?", [buy.json.data.payment.id]).catch(() => {});
    await query("DELETE FROM memberships WHERE id = ?", [buy.json.data.membership.id]).catch(() => {});
  } finally {
    await query("DELETE FROM users WHERE id = ?", [userId]).catch(() => {});
  }
});
