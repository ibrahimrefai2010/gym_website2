const planRepository = require("../repositories/planRepository");
const { createLog } = require("../utils/logger");

async function list(_req, res) {
  const data = await planRepository.listPlans();
  res.json({ success: true, data });
}

async function create(req, res) {
  const data = await planRepository.savePlan(req.body);
  await createLog("admin", req.user?.id, "plan.create", "plans", data.id, null, req.ip);
  res.status(201).json({ success: true, data });
}

async function update(req, res) {
  const data = await planRepository.savePlan({ ...req.body, id: req.params.id });
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
