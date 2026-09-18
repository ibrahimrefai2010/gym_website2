const { hasDatabaseConfig, query } = require("../config/database");
const { createHttpError } = require("../utils/httpError");
const { positiveInteger } = require("../utils/validator");
// Leads/CRM (Part 2): convertLeadToMember reuses customerRepository.createCustomer
// -- the exact same admin-initiated member-creation path customerController.create
// already uses -- rather than a second user-creation code path. See that
// function's own comment for why (inherits its ER_DUP_ENTRY -> 409
// CUSTOMER_EXISTS handling for free).
const customerRepository = require("./customerRepository");

const demoMessages = [
  {
    id: 1,
    name: "Lina Ahmed",
    email: "lina@example.com",
    phone: "+966500000011",
    subject: "Private tour",
    message: "I would like to book a tour this week.",
    status: "unread",
    source: "contact_form",
    leadStatus: "new",
    assignedTo: null,
    assignedToName: null,
    convertedUserId: null,
    createdAt: "2026-06-23"
  }
];

// Leads / CRM (Part 2): `messages` extends the existing contact-inbox table
// rather than a new table -- see migration 202609090001_admin_core.up.sql's
// own comment ("Leads / CRM: extend `messages` rather than a new table").
// `status` (unread/read/archived) stays the inbox "seen" concept;
// `lead_status` is the separate CRM pipeline this phase wires up.
const MESSAGE_SELECT = `SELECT m.id, m.name, m.email, m.phone, m.subject, m.message, m.status, m.source,
    m.lead_status, m.assigned_to, a.full_name AS assigned_to_name, m.converted_user_id,
    m.created_at, m.updated_at
  FROM messages m
  LEFT JOIN admin_users a ON a.id = m.assigned_to`;

function mapMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    subject: row.subject,
    message: row.message,
    status: row.status,
    source: row.source,
    leadStatus: row.lead_status,
    assignedTo: row.assigned_to,
    assignedToName: row.assigned_to_name || null,
    convertedUserId: row.converted_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapLeadNote(row) {
  if (!row) return null;
  return {
    id: row.id,
    messageId: row.message_id,
    note: row.note,
    createdBy: row.created_by,
    createdByName: row.created_by_name || null,
    createdAt: row.created_at
  };
}

async function createMessage(payload) {
  if (!hasDatabaseConfig()) {
    const message = {
      id: demoMessages.length + 1,
      status: "unread",
      source: "contact_form",
      leadStatus: "new",
      assignedTo: null,
      assignedToName: null,
      convertedUserId: null,
      createdAt: new Date().toISOString(),
      ...payload
    };
    demoMessages.unshift(message);
    return message;
  }

  const result = await query(
    `INSERT INTO messages (name, email, phone, subject, message, status, ip_address)
     VALUES (?, ?, ?, ?, ?, 'unread', ?)`,
    [payload.name, payload.email, payload.phone, payload.subject, payload.message, payload.ipAddress || null]
  );

  return getMessageById(result.insertId);
}

// Extended filter set: status (inbox "seen" state) alongside the new CRM
// pipeline filters (leadStatus, assignedTo, source) and a free-text search,
// mirroring customerRepository.listCustomers/taskRepository.listTasks's
// dynamic-WHERE + pagination shape ({ items, pagination }) rather than the
// old flat-array-of-100 return. See report: `messages` has no branch_id
// column at all (confirmed in Part 1's own recon and re-confirmed here --
// unlike tasks/customers there is deliberately no branchId filter param;
// leads stay branch-agnostic at the query layer until assigned to a branch-
// scoped admin, see messageController for the full reasoning).
async function listMessages({
  status = "",
  leadStatus = "",
  assignedTo = "",
  source = "",
  search = "",
  page = 1,
  pageSize = 20
} = {}) {
  if (!hasDatabaseConfig()) {
    let items = demoMessages.slice();
    if (status) items = items.filter((message) => message.status === status);
    if (leadStatus) items = items.filter((message) => message.leadStatus === leadStatus);
    if (assignedTo) items = items.filter((message) => String(message.assignedTo) === String(assignedTo));
    if (source) items = items.filter((message) => message.source === source);
    return { items, pagination: { page: 1, pageSize: items.length || 1, total: items.length } };
  }

  const where = [];
  const params = [];
  if (status) {
    where.push("m.status = ?");
    params.push(status);
  }
  if (leadStatus) {
    where.push("m.lead_status = ?");
    params.push(leadStatus);
  }
  if (assignedTo) {
    where.push("m.assigned_to = ?");
    params.push(assignedTo);
  }
  if (source) {
    where.push("m.source = ?");
    params.push(source);
  }
  if (search) {
    where.push("(m.name LIKE ? OR m.email LIKE ? OR m.phone LIKE ? OR m.subject LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = positiveInteger(pageSize, 20, 100);
  const currentPage = positiveInteger(page, 1, 1000000);
  const offset = (currentPage - 1) * limit;

  const rows = await query(
    `${MESSAGE_SELECT}
     ${whereSql}
     ORDER BY m.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const totalRows = await query(`SELECT COUNT(*) AS total FROM messages m ${whereSql}`, params);

  return {
    items: rows.map(mapMessage),
    pagination: { page: currentPage, pageSize: limit, total: Number(totalRows[0]?.total || 0) }
  };
}

async function getMessageById(id) {
  if (!hasDatabaseConfig()) {
    return demoMessages.find((item) => String(item.id) === String(id)) || null;
  }
  const rows = await query(`${MESSAGE_SELECT} WHERE m.id = ? LIMIT 1`, [id]);
  return mapMessage(rows[0]);
}

// Handles both the plain-inbox write (status only, via PUT /messages/:id)
// and the CRM-pipeline write (leadStatus/assignedTo, via PATCH
// /messages/:id/lead) through one shared statement -- see
// messageController.js for why these stay two separate routes/permissions
// even though they share this one repository function. assignedTo uses the
// same "CASE WHEN passed THEN new value ELSE existing" pattern as
// taskRepository.updateTask so an explicit `assignedTo: null` (unassign) is
// distinguishable from "field omitted, don't touch it".
async function updateMessage(id, payload = {}) {
  if (!hasDatabaseConfig()) {
    const message = demoMessages.find((item) => String(item.id) === String(id));
    if (!message) {
      throw createHttpError(404, "Message not found.", "MESSAGE_NOT_FOUND");
    }
    if (payload.status) message.status = payload.status;
    if (payload.leadStatus) message.leadStatus = payload.leadStatus;
    if (payload.assignedTo !== undefined) message.assignedTo = payload.assignedTo;
    return message;
  }

  const existing = await query("SELECT id FROM messages WHERE id = ? LIMIT 1", [id]);
  if (!existing[0]) {
    throw createHttpError(404, "Message not found.", "MESSAGE_NOT_FOUND");
  }

  await query(
    `UPDATE messages
     SET status = COALESCE(?, status),
         lead_status = COALESCE(?, lead_status),
         assigned_to = CASE WHEN ? THEN ? ELSE assigned_to END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      payload.status || null,
      payload.leadStatus || null,
      payload.assignedTo !== undefined ? 1 : 0,
      payload.assignedTo !== undefined ? payload.assignedTo : null,
      id
    ]
  );
  return getMessageById(id);
}

async function deleteMessage(id) {
  if (!hasDatabaseConfig()) {
    const index = demoMessages.findIndex((item) => String(item.id) === String(id));
    if (index >= 0) {
      demoMessages.splice(index, 1);
    }
    return { id, deleted: true };
  }

  await query("DELETE FROM messages WHERE id = ?", [id]);
  return { id, deleted: true };
}

async function listLeadNotes(messageId) {
  if (!hasDatabaseConfig()) {
    return [];
  }
  const rows = await query(
    `SELECT n.id, n.message_id, n.note, n.created_by, a.full_name AS created_by_name, n.created_at
     FROM lead_notes n
     LEFT JOIN admin_users a ON a.id = n.created_by
     WHERE n.message_id = ? AND n.deleted_at IS NULL
     ORDER BY n.created_at DESC`,
    [messageId]
  );
  return rows.map(mapLeadNote);
}

async function addLeadNote(messageId, note, adminId) {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
  const existing = await query("SELECT id FROM messages WHERE id = ? LIMIT 1", [messageId]);
  if (!existing[0]) {
    throw createHttpError(404, "Message not found.", "MESSAGE_NOT_FOUND");
  }

  const result = await query(`INSERT INTO lead_notes (message_id, note, created_by) VALUES (?, ?, ?)`, [
    messageId,
    note,
    adminId || null
  ]);
  const rows = await query(
    `SELECT n.id, n.message_id, n.note, n.created_by, a.full_name AS created_by_name, n.created_at
     FROM lead_notes n
     LEFT JOIN admin_users a ON a.id = n.created_by
     WHERE n.id = ? LIMIT 1`,
    [result.insertId]
  );
  return mapLeadNote(rows[0]);
}

// Convert Lead -> Member. Pre-fills an admin-initiated member registration
// from the lead's name/phone/email and creates it via
// customerRepository.createCustomer -- the same path customerController.create
// already uses for an admin manually adding a member -- rather than
// duplicating registration logic. branchId is resolved by the caller
// (messageController.convert, via security/branchAccess.resolveWriteBranchId)
// the same way an admin-initiated customer creation resolves it: a lead has
// no branch of its own, so converting one lands the new member in whichever
// branch the converting admin is scoped/switched to, exactly like a manual
// "Add customer" would.
async function convertLeadToMember(messageId, adminId, branchId) {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }

  const message = await getMessageById(messageId);
  if (!message) {
    throw createHttpError(404, "Message not found.", "MESSAGE_NOT_FOUND");
  }
  if (message.leadStatus === "converted" || message.convertedUserId) {
    throw createHttpError(409, "This lead has already been converted to a member.", "LEAD_ALREADY_CONVERTED");
  }

  // createCustomer already throws 409 CUSTOMER_EXISTS (ER_DUP_ENTRY on
  // users.email/phone) -- that's exactly the "lead's email/phone already
  // exists as a member" case, handled for free by reusing this path instead
  // of inventing a second one.
  const created = await customerRepository.createCustomer(
    {
      branchId,
      fullName: message.name,
      email: message.email,
      phone: message.phone
    },
    adminId
  );

  await query(
    `UPDATE messages SET lead_status = 'converted', converted_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [created.id, messageId]
  );

  return { userId: created.id, message: await getMessageById(messageId) };
}

module.exports = {
  addLeadNote,
  convertLeadToMember,
  createMessage,
  deleteMessage,
  getMessageById,
  listLeadNotes,
  listMessages,
  updateMessage
};
