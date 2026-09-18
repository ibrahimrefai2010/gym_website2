// Part 1 (Women's Branch) -- "effective viewing branch" resolution.
//
// admin_users.branch_id is NOT NULL for every admin, including super_admin
// (see migration 202609180001_women_branch.up.sql:37-44) -- there is no
// "branch-unrestricted" NULL state. A super_admin's own req.user.branchId is
// always a concrete "home" branch. Branch-switching is therefore a *separate*
// concept layered on top: the client may ask (via the X-View-Branch header)
// to view a different branch's data, and this module decides -- entirely
// server-side -- whether that request is honored.
//
// Security invariant: a non-switching admin's effective branch is always
// req.user.branchId, the DB-sourced value set by authenticate() (see
// src/middleware/auth.js:32-40). Nothing the client sends can move it.

const rbacRepository = require("../repositories/rbacRepository");
const branchRepository = require("../repositories/branchRepository");
const { createHttpError } = require("../utils/httpError");

// Header a client uses to ask to view a different branch's data. Only
// honored for admins who can actually switch (see canSwitchBranch).
const VIEW_BRANCH_HEADER = "x-view-branch";

async function canSwitchBranch(user) {
  if (!user || user.type !== "admin") {
    return false;
  }
  if (user.role === "super_admin") {
    return true;
  }
  return rbacRepository.hasPermission(user.id, user.role, "branches:manage");
}

// For GET/list requests: resolves the branch this request's data should be
// scoped to. Never throws on a bad/spoofed header -- falls back to the
// admin's own home branch instead (never a 500, per the brief).
async function resolveEffectiveBranchId(req) {
  const homeBranchId = req.user?.branchId ?? null;
  const headerValue = req.get ? req.get(VIEW_BRANCH_HEADER) : req.headers?.[VIEW_BRANCH_HEADER];
  if (!headerValue) {
    return homeBranchId;
  }

  const allowed = await canSwitchBranch(req.user);
  if (!allowed) {
    // Security-critical path: a non-switching admin's effective branch is
    // 100% server-derived. A spoofed header has zero effect.
    return homeBranchId;
  }

  const parsed = Number(headerValue);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return homeBranchId;
  }

  const valid = await branchRepository.isActiveBranchId(parsed);
  return valid ? parsed : homeBranchId;
}

// For write/create requests (plans, offers, settings): decides which branch
// a new/updated row belongs to.
//  - A non-switching admin's writes are always forced to their own home
//    branch, regardless of what the client sent in the payload.
//  - A switching admin (super_admin or branches:manage) may write to any
//    real, active branch they explicitly name; if they name none, the write
//    defaults to whichever branch they are currently viewing
//    (req.effectiveBranchId, set by the attachEffectiveBranch middleware),
//    falling back to their own home branch.
//  - A switching admin who explicitly names an invalid/inactive branch gets
//    a clear 422, rather than the write silently landing on the wrong branch.
async function resolveWriteBranchId(req, requestedBranchId) {
  const homeBranchId = req.user?.branchId ?? null;
  const allowed = await canSwitchBranch(req.user);
  if (!allowed) {
    return homeBranchId;
  }

  if (requestedBranchId === undefined || requestedBranchId === null || requestedBranchId === "") {
    return req.effectiveBranchId ?? homeBranchId;
  }

  const parsed = Number(requestedBranchId);
  if (!Number.isInteger(parsed) || parsed < 1 || !(await branchRepository.isActiveBranchId(parsed))) {
    throw createHttpError(422, "Invalid branch id.", "BRANCH_ID_INVALID");
  }
  return parsed;
}

// By-ID ownership gate: list-level filtering (resolveEffectiveBranchId) only
// protects listing endpoints -- fetching/mutating a *specific* record by its
// numeric id bypasses that filter entirely unless every by-id controller
// re-checks branch ownership itself. This is that one shared check.
//
//  - record: the already-fetched row (or null/undefined if none was found).
//    Reads record.branchId (camelCase, as repositories' mapped results use)
//    falling back to record.branch_id (raw SQL row shape) -- whichever the
//    caller's repository returns.
//  - req: the Express request; req.user.branchId is the admin's own
//    server-derived home branch, req.effectiveBranchId is their *current
//    viewing* branch (only meaningful for switching admins).
//  - notFoundError: the HttpError to throw both when the record does not
//    exist at all AND when it exists but belongs to a branch the requester
//    cannot currently act on. Collapsing both cases into the same 404
//    (same status, message and code) is deliberate -- it must be impossible
//    to tell "this id doesn't exist" apart from "this id belongs to a branch
//    you can't see" (see brief: don't leak existence across branches via a
//    distinguishable 403 vs 404). This codebase has no existing precedent
//    for using 403 on an ownership mismatch -- 403 here is reserved for
//    role/permission failures (see requirePermission/adminController), so
//    404 is also the *consistent* choice, not just the conservative one.
//
// A non-switching admin's permitted branch is always their fixed home
// branch (req.user.branchId) -- the same server-derived value
// resolveEffectiveBranchId falls back to. A switching admin (super_admin or
// branches:manage) must have their *effective* viewing branch match the
// record -- so even a super_admin who hasn't switched their viewer to
// "Women's Branch" cannot edit a Women's-branch record by guessing its id;
// they must explicitly switch first. See module docblock for why this is
// stricter than merely "super_admin can never cross branches".
async function assertBranchOwnership(record, req, notFoundError) {
  if (!record) {
    throw notFoundError;
  }

  const recordBranchId = record.branchId != null ? Number(record.branchId) : record.branch_id != null ? Number(record.branch_id) : null;
  if (recordBranchId == null) {
    // Record type isn't branch-scoped -- nothing to check.
    return record;
  }

  const allowed = await canSwitchBranch(req.user);
  const permittedBranchId = allowed
    ? req.effectiveBranchId ?? (await resolveEffectiveBranchId(req))
    : req.user?.branchId ?? null;

  if (permittedBranchId == null || Number(permittedBranchId) !== recordBranchId) {
    throw notFoundError;
  }

  return record;
}

module.exports = {
  VIEW_BRANCH_HEADER,
  assertBranchOwnership,
  canSwitchBranch,
  resolveEffectiveBranchId,
  resolveWriteBranchId
};
