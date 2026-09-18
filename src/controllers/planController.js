const planRepository = require("../repositories/planRepository");
const { createLog } = require("../utils/logger");

// Public route (no auth) -- branch comes from req.branch (subdomain), set by
// the branchResolver middleware mounted ahead of this route in app.js.
async function list(req, res) {
  const data = await planRepository.listPlans({ branchId: req.branch?.id || null });
  res.json({ success: true, data });
}

// Admin routes (authenticated) -- branch comes from the plan payload if the
// admin specified one, else defaults to the admin's own branch. Full
// cross-branch RBAC enforcement (e.g. restricting a branch-scoped admin from
// writing another branch's plans) is a later phase; this only wires the
// required branchId field through.
async function create(req, res) {
  const data = await planRepository.savePlan({ ...req.body, branchId: req.body.branchId || req.user?.branchId });
  await createLog("admin", req.user?.id, "plan.create", "plans", data.id, null, req.ip);
  res.status(201).json({ success: true, data });
}

async function update(req, res) {
  const data = await planRepository.savePlan({
    ...req.body,
    id: req.params.id,
    branchId: req.body.branchId || req.user?.branchId
  });
  await createLog("admin", req.user?.id, "plan.update", "plans", req.params.id, null, req.ip);
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
