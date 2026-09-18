const taskRepository = require("../repositories/taskRepository");
const { assertBranchOwnership, resolveWriteBranchId } = require("../security/branchAccess");
const { createHttpError } = require("../utils/httpError");
const { createLog } = require("../utils/logger");
const { assertEnum, cleanString, pagination, requireFields } = require("../utils/validator");

function taskNotFoundError() {
  return createHttpError(404, "Task not found.", "TASK_NOT_FOUND");
}

const PRIORITIES = ["low", "medium", "high", "urgent"];
const STATUSES = ["open", "in_progress", "done", "cancelled"];

async function list(req, res) {
  // branchId is server-derived (req.effectiveBranchId), matching every other
  // branch-scoped list endpoint in this app (see customerController.list) --
  // never taken from the query string.
  const data = await taskRepository.listTasks({
    ...pagination(req.query),
    branchId: req.effectiveBranchId || "",
    assignedTo: cleanString(req.query.assignedTo, 20),
    status: cleanString(req.query.status, 20),
    priority: cleanString(req.query.priority, 20),
    dueBefore: cleanString(req.query.dueBefore, 20),
    dueAfter: cleanString(req.query.dueAfter, 20),
    search: cleanString(req.query.search, 120)
  });
  res.json({ success: true, data });
}

async function detail(req, res) {
  const data = await taskRepository.getTask(req.params.id);
  // By-id fetch bypasses list()'s branchId filter entirely unless checked
  // here too, same gap class the Part 1 by-id audit fixed everywhere else
  // in this app (see src/security/branchAccess.js).
  await assertBranchOwnership(data, req, taskNotFoundError());
  res.json({ success: true, data });
}

async function create(req, res) {
  requireFields(req.body, ["title"]);
  if (req.body.priority) {
    assertEnum(cleanString(req.body.priority, 20), PRIORITIES, "Priority");
  }
  // branchId is server-resolved, same pattern as planController.create/
  // customerController.create -- a non-switching admin's new task always
  // lands in their own branch regardless of what the client sends.
  const branchId = await resolveWriteBranchId(req, req.body.branchId);
  const data = await taskRepository.createTask(
    {
      branchId,
      title: cleanString(req.body.title, 200),
      description: req.body.description !== undefined ? cleanString(req.body.description, 4000) : null,
      assignedTo: req.body.assignedTo || null,
      dueDate: req.body.dueDate || null,
      priority: req.body.priority || "medium",
      linkedResourceType: req.body.linkedResourceType ? cleanString(req.body.linkedResourceType, 100) : null,
      linkedResourceId: req.body.linkedResourceId || null
    },
    req.user?.id
  );
  await createLog("admin", req.user?.id, "task.create", "tasks", data.id, null, req.ip, branchId);
  res.status(201).json({ success: true, data });
}

async function update(req, res) {
  const existing = await taskRepository.getTask(req.params.id);
  await assertBranchOwnership(existing, req, taskNotFoundError());

  if (req.body.priority !== undefined) {
    assertEnum(cleanString(req.body.priority, 20), PRIORITIES, "Priority");
  }
  if (req.body.status !== undefined) {
    assertEnum(cleanString(req.body.status, 20), STATUSES, "Status");
  }

  const data = await taskRepository.updateTask(
    req.params.id,
    {
      title: req.body.title !== undefined ? cleanString(req.body.title, 200) : undefined,
      description: req.body.description !== undefined ? cleanString(req.body.description, 4000) : undefined,
      assignedTo: req.body.assignedTo !== undefined ? req.body.assignedTo || null : undefined,
      dueDate: req.body.dueDate !== undefined ? req.body.dueDate || null : undefined,
      priority: req.body.priority,
      status: req.body.status
    },
    req.user?.id
  );
  await createLog("admin", req.user?.id, "task.update", "tasks", req.params.id, null, req.ip, existing.branchId);
  res.json({ success: true, data });
}

async function close(req, res) {
  const existing = await taskRepository.getTask(req.params.id);
  await assertBranchOwnership(existing, req, taskNotFoundError());

  const outcomeNote = req.body.outcomeNote !== undefined ? cleanString(req.body.outcomeNote, 2000) : null;
  const data = await taskRepository.closeTask(req.params.id, { outcomeNote }, req.user?.id);
  await createLog("admin", req.user?.id, "task.close", "tasks", req.params.id, { outcomeNote }, req.ip, existing.branchId);
  res.json({ success: true, data });
}

async function cancel(req, res) {
  const existing = await taskRepository.getTask(req.params.id);
  await assertBranchOwnership(existing, req, taskNotFoundError());

  const data = await taskRepository.cancelTask(req.params.id, req.user?.id);
  await createLog("admin", req.user?.id, "task.cancel", "tasks", req.params.id, null, req.ip, existing.branchId);
  res.json({ success: true, data });
}

module.exports = {
  cancel,
  close,
  create,
  detail,
  list,
  update
};
