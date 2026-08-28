const branchRepository = require("../repositories/branchRepository");
const { createLog } = require("../utils/logger");
const { cleanString, pagination, requireFields } = require("../utils/validator");

async function list(req, res) {
  const data = await branchRepository.listBranches({
    ...pagination(req.query),
    search: cleanString(req.query.search, 120),
    status: cleanString(req.query.status, 20)
  });
  res.json({ success: true, data });
}

async function create(req, res) {
  requireFields(req.body, ["code", "nameEn", "nameAr"]);
  const data = await branchRepository.saveBranch(req.body, req.user?.id);
  await createLog("admin", req.user?.id, "branch.create", "branches", data.id, null, req.ip);
  res.status(201).json({ success: true, data });
}

async function update(req, res) {
  const data = await branchRepository.saveBranch({ ...req.body, id: req.params.id }, req.user?.id);
  await createLog("admin", req.user?.id, "branch.update", "branches", req.params.id, null, req.ip);
  res.json({ success: true, data });
}

async function remove(req, res) {
  const data = await branchRepository.deleteBranch(req.params.id, req.user?.id);
  await createLog("admin", req.user?.id, "branch.delete", "branches", req.params.id, null, req.ip);
  res.json({ success: true, data });
}

module.exports = {
  create,
  list,
  remove,
  update
};
