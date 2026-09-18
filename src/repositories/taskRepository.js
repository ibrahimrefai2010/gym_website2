const { hasDatabaseConfig, query } = require("../config/database");
const { createHttpError } = require("../utils/httpError");
const { positiveInteger } = require("../utils/validator");

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

function mapTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    branchId: row.branch_id,
    title: row.title,
    description: row.description,
    assignedTo: row.assigned_to,
    assignedToName: row.assigned_to_name || null,
    dueDate: row.due_date,
    priority: row.priority,
    status: row.status,
    linkedResourceType: row.linked_resource_type,
    linkedResourceId: row.linked_resource_id,
    outcomeNote: row.outcome_note,
    createdBy: row.created_by,
    createdByName: row.created_by_name || null,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const TASK_SELECT = `SELECT t.*, a.full_name AS assigned_to_name, c.full_name AS created_by_name
   FROM tasks t
   LEFT JOIN admin_users a ON a.id = t.assigned_to
   LEFT JOIN admin_users c ON c.id = t.created_by`;

// branchId is required for a real list -- an empty/absent value means "no
// rows", not "every branch", same convention as customerRepository.listCustomers
// (see src/security/branchAccess.js -- callers always pass req.effectiveBranchId).
async function listTasks({
  branchId = "",
  assignedTo = "",
  status = "",
  priority = "",
  dueBefore = "",
  dueAfter = "",
  search = "",
  page = 1,
  pageSize = 25
} = {}) {
  ensureDatabase();
  const where = [];
  const params = [];

  if (branchId) {
    where.push("t.branch_id = ?");
    params.push(branchId);
  } else {
    where.push("1 = 0");
  }
  if (assignedTo) {
    where.push("t.assigned_to = ?");
    params.push(assignedTo);
  }
  if (status) {
    where.push("t.status = ?");
    params.push(status);
  }
  if (priority) {
    where.push("t.priority = ?");
    params.push(priority);
  }
  if (dueBefore) {
    where.push("t.due_date IS NOT NULL AND t.due_date <= ?");
    params.push(dueBefore);
  }
  if (dueAfter) {
    where.push("t.due_date IS NOT NULL AND t.due_date >= ?");
    params.push(dueAfter);
  }
  if (search) {
    where.push("(t.title LIKE ? OR t.description LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  const limit = positiveInteger(pageSize, 25, 100);
  const currentPage = positiveInteger(page, 1, 1000000);
  const offset = (currentPage - 1) * limit;
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await query(
    `${TASK_SELECT}
     ${whereClause}
     ORDER BY
       CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'done' THEN 2 ELSE 3 END ASC,
       CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END ASC,
       t.due_date ASC,
       t.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const totalRows = await query(
    `SELECT COUNT(*) AS total FROM tasks t ${whereClause}`,
    params
  );

  return {
    items: rows.map(mapTask),
    pagination: { page: currentPage, pageSize: limit, total: Number(totalRows[0]?.total || 0) }
  };
}

async function getTask(id) {
  ensureDatabase();
  const rows = await query(`${TASK_SELECT} WHERE t.id = ? LIMIT 1`, [id]);
  return mapTask(rows[0]);
}

async function createTask(payload, adminId = null) {
  ensureDatabase();
  const result = await query(
    `INSERT INTO tasks
      (branch_id, title, description, assigned_to, due_date, priority, status,
       linked_resource_type, linked_resource_id, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
    [
      payload.branchId,
      payload.title,
      payload.description || null,
      payload.assignedTo || null,
      payload.dueDate || null,
      payload.priority || "medium",
      payload.linkedResourceType || null,
      payload.linkedResourceId || null,
      adminId,
      adminId
    ]
  );
  return getTask(result.insertId);
}

async function updateTask(id, payload, adminId = null) {
  ensureDatabase();
  const existing = await query("SELECT id FROM tasks WHERE id = ? LIMIT 1", [id]);
  if (!existing[0]) {
    throw createHttpError(404, "Task not found.", "TASK_NOT_FOUND");
  }

  await query(
    `UPDATE tasks
     SET title = COALESCE(?, title),
         description = CASE WHEN ? THEN ? ELSE description END,
         assigned_to = CASE WHEN ? THEN ? ELSE assigned_to END,
         due_date = CASE WHEN ? THEN ? ELSE due_date END,
         priority = COALESCE(?, priority),
         status = COALESCE(?, status),
         updated_by = ?,
         updated_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [
      payload.title || null,
      payload.description !== undefined ? 1 : 0,
      payload.description !== undefined ? payload.description : null,
      payload.assignedTo !== undefined ? 1 : 0,
      payload.assignedTo !== undefined ? payload.assignedTo : null,
      payload.dueDate !== undefined ? 1 : 0,
      payload.dueDate !== undefined ? payload.dueDate : null,
      payload.priority || null,
      payload.status || null,
      adminId,
      id
    ]
  );
  return getTask(id);
}

async function closeTask(id, { outcomeNote } = {}, adminId = null) {
  ensureDatabase();
  const existing = await query("SELECT id FROM tasks WHERE id = ? LIMIT 1", [id]);
  if (!existing[0]) {
    throw createHttpError(404, "Task not found.", "TASK_NOT_FOUND");
  }
  await query(
    `UPDATE tasks
     SET status = 'done', outcome_note = COALESCE(?, outcome_note), updated_by = ?, updated_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [outcomeNote || null, adminId, id]
  );
  return getTask(id);
}

// Soft-cancel: sets status = 'cancelled'. Never hard-deletes a task row (per
// brief) -- a task can be a compliance/audit trail (e.g. "was this lead ever
// followed up on"), same reasoning as messages/logs never being hard-deleted
// elsewhere in this app.
async function cancelTask(id, adminId = null) {
  ensureDatabase();
  const existing = await query("SELECT id FROM tasks WHERE id = ? LIMIT 1", [id]);
  if (!existing[0]) {
    throw createHttpError(404, "Task not found.", "TASK_NOT_FOUND");
  }
  await query(
    `UPDATE tasks SET status = 'cancelled', updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?`,
    [adminId, id]
  );
  return getTask(id);
}

// Dashboard widget: open/in-progress task counts by priority, for one branch.
async function countOpenByPriority({ branchId } = {}) {
  ensureDatabase();
  if (!branchId) {
    return { low: 0, medium: 0, high: 0, urgent: 0 };
  }
  const rows = await query(
    `SELECT priority, COUNT(*) AS total
     FROM tasks
     WHERE branch_id = ? AND status IN ('open', 'in_progress')
     GROUP BY priority`,
    [branchId]
  );
  const counts = { low: 0, medium: 0, high: 0, urgent: 0 };
  rows.forEach((row) => {
    counts[row.priority] = Number(row.total || 0);
  });
  return counts;
}

// Dashboard widget: open/in-progress tasks whose due_date has passed.
async function countOverdue({ branchId } = {}) {
  ensureDatabase();
  if (!branchId) {
    return 0;
  }
  const rows = await query(
    `SELECT COUNT(*) AS total
     FROM tasks
     WHERE branch_id = ? AND status IN ('open', 'in_progress') AND due_date IS NOT NULL AND due_date < UTC_TIMESTAMP()`,
    [branchId]
  );
  return Number(rows[0]?.total || 0);
}

module.exports = {
  cancelTask,
  closeTask,
  countOpenByPriority,
  countOverdue,
  createTask,
  getTask,
  listTasks,
  updateTask
};
