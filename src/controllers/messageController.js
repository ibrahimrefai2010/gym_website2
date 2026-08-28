const messageRepository = require("../repositories/messageRepository");
const { assertEmail, assertEnum, assertMaxLength, cleanEmail, cleanPhone, cleanString, requireFields } = require("../utils/validator");
const { auditLog } = require("../utils/logger");

async function create(req, res) {
  if (cleanString(req.body.website, 120)) {
    res.json({ success: true, data: { accepted: true } });
    return;
  }

  requireFields(req.body, ["name", "email", "phone", "subject", "message"]);
  assertEmail(req.body.email);
  assertMaxLength(req.body.message, 2000, "Message");
  const data = await messageRepository.createMessage({
    name: cleanString(req.body.name, 160),
    email: cleanEmail(req.body.email),
    phone: cleanPhone(req.body.phone),
    subject: cleanString(req.body.subject, 180),
    message: cleanString(req.body.message, 2000),
    ipAddress: req.ip
  });
  await auditLog({
    action: "message.created",
    entityType: "message",
    entityId: data.id,
    description: "New contact message",
    ipAddress: req.ip
  });
  res.status(201).json({ success: true, data });
}

async function list(req, res) {
  const data = await messageRepository.listMessages({ status: req.query.status });
  res.json({ success: true, data });
}

async function update(req, res) {
  const status = cleanString(req.body.status, 20);
  assertEnum(status, ["unread", "read", "archived"], "Message status");
  const data = await messageRepository.updateMessage(req.params.id, {
    status
  });
  await auditLog({
    actorId: req.user?.id,
    action: "message.updated",
    entityType: "message",
    entityId: req.params.id,
    description: "Contact message updated",
    ipAddress: req.ip
  });
  res.json({ success: true, data });
}

async function remove(req, res) {
  const data = await messageRepository.deleteMessage(req.params.id);
  await auditLog({
    actorId: req.user?.id,
    action: "message.deleted",
    entityType: "message",
    entityId: req.params.id,
    description: "Contact message deleted",
    ipAddress: req.ip
  });
  res.json({ success: true, data });
}

module.exports = {
  create,
  list,
  remove,
  update
};
