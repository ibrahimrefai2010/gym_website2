const membershipRepository = require("../repositories/membershipRepository");
const membershipService = require("../services/membershipService");

async function list(req, res) {
  const data = await membershipRepository.listMemberships(req.effectiveBranchId || req.user?.branchId || null);
  res.json({ success: true, data });
}

async function mine(req, res) {
  const data = await membershipRepository.getMine(req.user.id);
  res.json({ success: true, data });
}

async function buy(req, res) {
  const data = await membershipService.buy(req.user.id, req.body, { ipAddress: req.ip });
  res.status(201).json({ success: true, data });
}

async function activate(req, res) {
  const data = await membershipService.activate(req.user.id, req.params.id, { ipAddress: req.ip });
  res.json({ success: true, data });
}

async function cancel(req, res) {
  const data = await membershipService.cancel(req.user.id, req.params.id, { ipAddress: req.ip });
  res.json({ success: true, data });
}

async function action(req, res) {
  const data = await membershipRepository.updateMembership(req.params.id, req.body.action, req.body);
  res.json({ success: true, data });
}

module.exports = {
  action,
  activate,
  buy,
  cancel,
  list,
  mine
};
