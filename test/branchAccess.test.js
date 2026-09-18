const test = require("node:test");
const assert = require("node:assert/strict");
const { hasDatabaseConfig, query, getPool } = require("../src/config/database");
const {
  canSwitchBranch,
  resolveEffectiveBranchId,
  resolveWriteBranchId
} = require("../src/security/branchAccess");

const noDb = !hasDatabaseConfig();

test.after(async () => {
  const pool = getPool();
  if (pool) await pool.end();
});

function fakeReq(user, headers = {}) {
  const lowered = {};
  for (const [key, value] of Object.entries(headers)) {
    lowered[key.toLowerCase()] = value;
  }
  return {
    user,
    effectiveBranchId: undefined,
    get(name) {
      return lowered[String(name).toLowerCase()];
    }
  };
}

// --- No-DB-required: these prove the security-critical "spoofed header has
// zero effect" path without needing a database, since a non-switching
// admin's effective branch is decided before any branch-lookup query runs. ---

test("a non-switching admin's spoofed X-View-Branch header has zero effect", async () => {
  const req = fakeReq({ id: 42, type: "admin", role: "branch_manager", branchId: 1 }, { "X-View-Branch": "2" });
  const effective = await resolveEffectiveBranchId(req);
  assert.equal(effective, 1, "must stay pinned to the admin's own DB-sourced home branch, never the header");
});

test("a non-switching admin with no header just gets their own home branch", async () => {
  const req = fakeReq({ id: 7, type: "admin", role: "staff", branchId: 3 });
  const effective = await resolveEffectiveBranchId(req);
  assert.equal(effective, 3);
});

test("canSwitchBranch is true for super_admin without needing the database", async () => {
  const allowed = await canSwitchBranch({ id: 1, type: "admin", role: "super_admin" });
  assert.equal(allowed, true);
});

test("canSwitchBranch is false for a role without branches:manage (falls back to DEFAULT_ROLE_PERMISSIONS when RBAC tables are unavailable)", async () => {
  const allowed = await canSwitchBranch({ id: 1, type: "admin", role: "branch_manager" });
  assert.equal(allowed, false, "branchManagerPermissions does not include branches:manage");
});

test("resolveWriteBranchId forces a non-switching admin's write to their own branch even if the client sends a different one", async () => {
  const req = fakeReq({ id: 9, type: "admin", role: "branch_manager", branchId: 2 });
  const branchId = await resolveWriteBranchId(req, 5);
  assert.equal(branchId, 2, "the spoofed body.branchId=5 must be ignored server-side");
});

test("resolveEffectiveBranchId never throws on a garbage header, even for a switcher", async () => {
  const req = fakeReq({ id: 1, type: "admin", role: "super_admin", branchId: 1 }, { "X-View-Branch": "not-a-number" });
  const effective = await resolveEffectiveBranchId(req);
  assert.equal(effective, 1);
});

// --- DB-gated: proves the switching admin's path actually works end-to-end
// against real branch rows (self-skips without DB config, matching this
// repo's other *.test.js files). ---

test(
  "a super_admin sending a valid X-View-Branch header for a real, active branch actually gets that branch",
  { skip: noDb },
  async () => {
    const women = await query("SELECT id FROM branches WHERE code = 'women' AND status = 'active' LIMIT 1");
    if (!women[0]) {
      return; // Women's branch row not present on this database
    }
    const req = fakeReq({ id: 1, type: "admin", role: "super_admin", branchId: 1 }, { "X-View-Branch": String(women[0].id) });
    const effective = await resolveEffectiveBranchId(req);
    assert.equal(effective, women[0].id);
  }
);

test(
  "a super_admin sending an invalid/inactive branch id falls back to their home branch instead of 500ing",
  { skip: noDb },
  async () => {
    const req = fakeReq({ id: 1, type: "admin", role: "super_admin", branchId: 1 }, { "X-View-Branch": "999999" });
    const effective = await resolveEffectiveBranchId(req);
    assert.equal(effective, 1);
  }
);

test(
  "membershipRepository.buy rejects a plan from a different branch than the purchasing user's own",
  { skip: noDb },
  async () => {
    const membershipRepository = require("../src/repositories/membershipRepository");
    const mainUser = await query(
      "SELECT id FROM users WHERE branch_id = 1 AND deleted_at IS NULL LIMIT 1"
    );
    const womenPlan = await query(
      `SELECT p.id FROM plans p
       JOIN branches b ON b.id = p.branch_id
       WHERE b.code = 'women' AND p.deleted_at IS NULL AND p.is_active = 1
       LIMIT 1`
    );
    if (!mainUser[0] || !womenPlan[0]) {
      return; // fixtures (a Main-branch user, a Women's-branch plan) not present on this database
    }

    await assert.rejects(
      () => membershipRepository.buy({ userId: mainUser[0].id, planId: womenPlan[0].id }),
      (error) => error.code === "PLAN_BRANCH_MISMATCH",
      "buying a Women's-branch plan as a Main-branch user must be rejected"
    );
  }
);
