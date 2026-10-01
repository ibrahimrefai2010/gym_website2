const messageRepository = require("../repositories/messageRepository");
const taskService = require("../services/taskService");
const { assertBranchOwnership } = require("../security/branchAccess");
const { createHttpError } = require("../utils/httpError");
const { assertEmail, assertEnum, assertMaxLength, cleanEmail, cleanPhone, cleanString, requireFields } = require("../utils/validator");
const { auditLog, appLogger } = require("../utils/logger");

const LEAD_STATUSES = ["new", "contacted", "converted", "rejected"];

function messageNotFoundError() {
  return createHttpError(404, "Message not found.", "MESSAGE_NOT_FOUND");
}

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
    // The branch whose site the form was submitted on (subdomain-resolved).
    branchId: req.branch?.id || 1,
    ipAddress: req.ip
  });
  await auditLog({
    action: "message.created",
    entityType: "message",
    entityId: data.id,
    description: "New contact message",
    ipAddress: req.ip
  });
  // Tasks/Follow-ups auto-generation trigger 2: a follow-up task for the new
  // lead, gated by the branch's task_autogen_new_leads setting (see
  // taskService.createTaskForNewLead). messages has no branch_id column of
  // its own (left un-branch-scoped by design -- see
  // adminRepository.getOverview's comment), so the branch comes from
  // req.branch instead -- the same subdomain-resolved signal
  // middleware/branchResolver.js attaches to every request, public or not.
  // Best-effort: must never fail the contact-form submission itself.
  taskService
    .createTaskForNewLead(data, req.branch?.id)
    .catch((error) => appLogger.error({ error, messageId: data.id }, "Task autogen (new lead) failed"));
  res.status(201).json({ success: true, data });
}

// Leads/CRM (Part 2): extended filter set (leadStatus/assignedTo/source/
// search) alongside the existing status filter, plus pagination -- see
// messageRepository.listMessages. No branch filter: `messages` has no
// branch_id column (confirmed in Part 1's own recon), so leads stay
// branch-agnostic at the list layer -- see that repository function's own
// comment and the report for the full reasoning. Gated by
// requireAnyPermission(messages:write, leads:read) in messageRoutes.js so
// both the plain-inbox audience and the CRM-only audience (e.g. marketing,
// which has leads:read but not messages:write) can reach this one list.
async function list(req, res) {
  const data = await messageRepository.listMessages({
    branchId: req.effectiveBranchId || "",
    status: cleanString(req.query.status, 20),
    leadStatus: cleanString(req.query.leadStatus, 20),
    assignedTo: cleanString(req.query.assignedTo, 20),
    source: cleanString(req.query.source, 40),
    search: cleanString(req.query.search, 160),
    page: req.query.page,
    pageSize: req.query.pageSize
  });
  res.json({ success: true, data });
}

// Plain-inbox write: status only (read/archive), unchanged behavior/
// permission (messages:write) from before this phase.
// Every by-id lead route: another branch's lead is the same 404 as a
// missing one.
async function ownedMessage(req) {
  const existing = await messageRepository.getMessageById(req.params.id);
  await assertBranchOwnership(existing, req, messageNotFoundError());
  return existing;
}

async function update(req, res) {
  await ownedMessage(req);
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

// CRM-pipeline write: lead_status and/or assigned_to. A separate route/
// permission (leads:write) from the plain-inbox update above -- see
// messageRoutes.js and the report for why this codebase's own permission
// catalog (leads:write's description: "Assign, update, note, convert, and
// export leads") already draws this exact line.
async function updateLead(req, res) {
  await ownedMessage(req);

  if (req.body.leadStatus !== undefined) {
    assertEnum(cleanString(req.body.leadStatus, 20), LEAD_STATUSES, "Lead status");
  }

  const data = await messageRepository.updateMessage(req.params.id, {
    leadStatus: req.body.leadStatus !== undefined ? cleanString(req.body.leadStatus, 20) : undefined,
    assignedTo: req.body.assignedTo !== undefined ? req.body.assignedTo || null : undefined
  });
  await auditLog({
    actorId: req.user?.id,
    action: "lead.updated",
    entityType: "message",
    entityId: req.params.id,
    description: "Lead pipeline fields updated",
    ipAddress: req.ip,
    context: { leadStatus: req.body.leadStatus, assignedTo: req.body.assignedTo }
  });
  res.json({ success: true, data });
}

async function listNotes(req, res) {
  await ownedMessage(req);
  const data = await messageRepository.listLeadNotes(req.params.id);
  res.json({ success: true, data });
}

async function addNote(req, res) {
  await ownedMessage(req);
  requireFields(req.body, ["note"]);
  assertMaxLength(req.body.note, 2000, "Note");
  const data = await messageRepository.addLeadNote(req.params.id, cleanString(req.body.note, 2000), req.user?.id);
  await auditLog({
    actorId: req.user?.id,
    action: "lead.note_added",
    entityType: "message",
    entityId: req.params.id,
    description: "Lead follow-up note added",
    ipAddress: req.ip
  });
  res.status(201).json({ success: true, data });
}

// Convert Lead -> Member. branchId is server-resolved the same way an
// admin-initiated customer creation resolves it (resolveWriteBranchId --
// see customerController.create): a non-switching admin's new member always
// lands in their own branch; a switching admin may target any branch
// they're permitted to. A lead has no branch of its own to inherit.
async function convert(req, res) {
  const lead = await ownedMessage(req);
  const branchId = lead.branchId;
  const data = await messageRepository.convertLeadToMember(req.params.id, req.user?.id, branchId);
  await auditLog({
    actorId: req.user?.id,
    action: "lead.converted",
    entityType: "message",
    entityId: req.params.id,
    description: "Lead converted to member",
    ipAddress: req.ip,
    context: { userId: data.userId, branchId }
  });
  res.status(201).json({ success: true, data });
}

async function remove(req, res) {
  await ownedMessage(req);
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
  addNote,
  convert,
  create,
  list,
  listNotes,
  remove,
  update,
  updateLead
};
