const documentRepository = require("../repositories/documentRepository");
const { createLog } = require("../utils/logger");
const { cleanString, pagination, requireFields } = require("../utils/validator");

async function list(req, res) {
  const data = await documentRepository.listDocuments({
    ...pagination(req.query),
    ownerType: cleanString(req.query.ownerType, 40),
    ownerId: cleanString(req.query.ownerId, 40),
    category: cleanString(req.query.category, 40)
  });
  res.json({ success: true, data });
}

async function create(req, res) {
  requireFields(req.body, ["ownerType", "ownerId", "originalName", "storagePath"]);
  const data = await documentRepository.createDocument(req.body, req.user?.id);
  await createLog("admin", req.user?.id, "document.create", "documents", data.id, null, req.ip);
  res.status(201).json({ success: true, data });
}

module.exports = {
  create,
  list
};
