const aiAssistantService = require("../services/aiAssistantService");
const { cleanString, requireFields } = require("../utils/validator");

async function ask(req, res) {
  requireFields(req.body, ["prompt"]);
  const data = await aiAssistantService.ask({
    prompt: cleanString(req.body.prompt, 2000),
    branchId: cleanString(req.body.branchId || req.query.branchId || "", 20) || null,
    adminId: req.user?.id
  });
  res.json({ success: true, data });
}

module.exports = {
  ask
};
