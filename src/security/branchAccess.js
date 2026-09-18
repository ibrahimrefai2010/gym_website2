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

module.exports = {
  VIEW_BRANCH_HEADER,
  canSwitchBranch,
  resolveEffectiveBranchId,
  resolveWriteBranchId
};
