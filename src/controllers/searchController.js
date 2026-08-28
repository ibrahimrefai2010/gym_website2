const searchRepository = require("../repositories/searchRepository");
const { cleanString } = require("../utils/validator");
const rbacRepository = require("../repositories/rbacRepository");

async function search(req, res) {
  const data = await searchRepository.globalSearch({
    q: cleanString(req.query.q, 120),
    branchId: cleanString(req.query.branchId, 20),
    limit: Math.min(Number(req.query.limit || 8), 20),
    includeSettings: await rbacRepository.hasPermission(req.user?.id, req.user?.role, "settings:write")
  });
  res.json({ success: true, data });
}

module.exports = {
  search
};
