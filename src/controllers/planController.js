const planRepository = require("../repositories/planRepository");
const { resolveWriteBranchId } = require("../security/branchAccess");
const { createLog } = require("../utils/logger");

// Public route (no auth) -- branch comes from req.branch (subdomain), set by
// the branchResolver middleware mounted ahead of this route in app.js.
async function list(req, res) {
  const data = await planRepository.listPlans({ branchId: req.branch?.id || null });
  res.json({ success: true, data });
}

// Admin routes (authenticated). branchId resolution is security-critical: a
// non-switching admin's writes are always forced to their own branch
// (req.user.branchId), regardless of what the client sends -- a
// branches:manage/super_admin admin may target another real, active branch.
// See src/security/branchAccess.js#resolveWriteBranchId.
async function create(req, res) {
  const branchId = await resolveWriteBranchId(req, req.body.branchId);
  const data = await planRepository.savePlan({ ...req.body, branchId });
  await createLog("admin", req.user?.id, "plan.create", "plans", data.id, null, req.ip, branchId);
  res.status(201).json({ success: true, data });
}

async function update(req, res) {
  const branchId = await resolveWriteBranchId(req, req.body.branchId);
  const data = await planRepository.savePlan({
    ...req.body,
    id: req.params.id,
    branchId
  });
  await createLog("admin", req.user?.id, "plan.update", "plans", req.params.id, null, req.ip, branchId);
  res.json({ success: true, data });
}

async function remove(req, res) {
  const data = await planRepository.deletePlan(req.params.id);
  await createLog("admin", req.user?.id, "plan.delete", "plans", req.params.id, null, req.ip);
  res.json({ success: true, data });
}

module.exports = {
  create,
  list,
  remove,
  update
};
