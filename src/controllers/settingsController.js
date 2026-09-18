const settingsRepository = require("../repositories/settingsRepository");
const { assertEnum, cleanString, requireFields } = require("../utils/validator");
const { createLog } = require("../utils/logger");

async function list(req, res) {
  const data = await settingsRepository.listSettings(req.user?.branchId || 1);
  res.json({ success: true, data });
}

async function save(req, res) {
  requireFields(req.body, ["key"]);
  const type = cleanString(req.body.type || "string", 20);
  assertEnum(type, ["string", "number", "boolean", "json"], "Setting type");
  const data = await settingsRepository.saveSetting(
    cleanString(req.body.key, 100),
    cleanString(req.body.value, 2000),
    req.user?.id,
    type,
    req.user?.branchId || 1
  );
  await createLog("admin", req.user?.id, "settings.update", "settings", null, { key: data.key }, req.ip);
  res.json({ success: true, data });
}

async function publicList(req, res) {
  const data = await settingsRepository.publicSettings(req.branch?.id || 1);
  res.json({ success: true, data });
}

module.exports = {
  list,
  publicList,
  save
};
