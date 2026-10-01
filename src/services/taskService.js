// Auto-generation logic for Tasks / Follow-ups. Mirrors the
// membershipService/membershipRepository split (service wraps repository
// calls with the extra business logic a plain CRUD repository shouldn't
// own -- see src/services/membershipService.js) -- taskRepository.js stays
// pure CRUD, this file owns "when/why a task gets created automatically".
//
// Each trigger is gated by a branch-scoped settings flag (see migration
// 202609180003_tasks -- task_autogen_expiring_memberships /
// task_autogen_new_leads) so a branch can turn off auto-generation for a
// given trigger without code changes. settingsRepository.getSetting's
// fallback (true) covers a branch that has no row for the key yet (a brand
// new branch, or a DB not yet migrated past the seed step), so autogen is
// enabled by default everywhere.
//
// Every auto-created task is left unassigned (assigned_to = NULL) rather
// than guessing a "senior admin" -- this app has no single always-present
// "branch owner" admin role/flag to pick from safely (RBAC roles are
// per-branch admin_users rows, not a designated seniority ranking), and an
// incorrect auto-assignment is worse than none: the task still shows up on
// the branch's open-tasks list and dashboard widget either way, and any
// admin with tasks:manage can claim/reassign it from there. Documented here
// per the brief rather than silently picking a role.
const taskRepository = require("../repositories/taskRepository");
const settingsRepository = require("../repositories/settingsRepository");

async function autogenEnabled(key, branchId) {
  // getSetting's fallback (true) is returned as-is (not cast) when no row
  // exists for this branch/key -- see settingsRepository.getSetting.
  const value = await settingsRepository.getSetting(key, true, branchId);
  return value === true || value === "true" || value === 1 || value === "1";
}

function priorityForWindow(windowDays) {
  if (windowDays <= 1) return "urgent";
  if (windowDays <= 3) return "high";
  return "medium";
}

// Trigger 1: membership-expiry reminders (src/jobs/cron.js's renewalReminders,
// which already fires at 7/3/1 days before expiry -- see that file for why no
// de-duplication is needed: each membership crosses each threshold exactly
// once). Called once per membership per threshold crossed.
async function createTaskForExpiringMembership(membership, windowDays) {
  const branchId = membership?.branchId;
  if (!branchId) {
    return null;
  }
  const enabled = await autogenEnabled("task_autogen_expiring_memberships", branchId);
  if (!enabled) {
    return null;
  }

  const memberLabel = membership.userFullName || `member #${membership.userId}`;
  return taskRepository.createTask(
    {
      branchId,
      title: `Membership renewal follow-up: ${memberLabel} (${windowDays}-day reminder)`,
      description: `Membership #${membership.id} for ${memberLabel}${membership.planName ? ` (${membership.planName})` : ""} expires ${
        membership.endDate ? `on ${membership.endDate}` : "soon"
      }. Follow up about renewal before access lapses.`,
      assignedTo: null,
      dueDate: membership.endDate || null,
      priority: priorityForWindow(windowDays),
      linkedResourceType: "membership",
      linkedResourceId: membership.id
    },
    null
  );
}

// Trigger 2: a new contact-form lead (src/repositories/messageRepository.js's
// createMessage). messages has no branch_id column at all (left un-branch-
// scoped by design -- see adminRepository.getOverview's comment and the
// brief's own note that the leads/CRM pipeline is out of scope beyond this
// one hook), so branchId here is NOT read off the message row -- it's the
// branch the request itself resolved to (req.branch, set by
// middleware/branchResolver.js for every request, authenticated or not, via
// the app.js-level app.use(resolveBranch)). That's the same subdomain-based
// signal the rest of the public site already uses, and it's always present
// (falls back to Main), so this never has to guess.
async function createTaskForNewLead(message, branchId) {
  if (!branchId) {
    return null;
  }
  const enabled = await autogenEnabled("task_autogen_new_leads", branchId);
  if (!enabled) {
    return null;
  }

  return taskRepository.createTask(
    {
      branchId,
      title: `New lead follow-up: ${message.name || "Unknown"}`,
      description: `New contact-form message from ${message.name || "Unknown"}${
        message.subject ? ` — "${message.subject}"` : ""
      }. Phone: ${message.phone || "—"}, Email: ${message.email || "—"}.`,
      assignedTo: null,
      dueDate: null,
      priority: "medium",
      linkedResourceType: "message",
      linkedResourceId: message.id
    },
    null
  );
}

// Trigger 3: a failed online (Moyasar) payment -- called once per attempt by
// paymentService when an attempt closes as failed (declined card, amount
// mismatch, abandoned after a failed card attempt). Gated by the per-branch
// task_autogen_failed_payments setting (migration 202610010001).
async function createTaskForFailedPayment(payment, branchId) {
  if (!branchId) {
    return null;
  }
  const enabled = await autogenEnabled("task_autogen_failed_payments", branchId);
  if (!enabled) {
    return null;
  }
  return taskRepository.createTask(
    {
      branchId,
      title: `Payment follow-up: failed payment${payment?.id ? ` #${payment.id}` : ""}`,
      description: `Online payment${payment?.id ? ` #${payment.id}` : ""} failed${
        payment?.amount ? ` (${payment.amount} ${payment.currency || ""})` : ""
      }${payment?.failureReason ? ` -- reason: ${payment.failureReason}` : ""}. Follow up with the member about retrying or paying at reception.`,
      assignedTo: null,
      dueDate: null,
      priority: "high",
      linkedResourceType: "payment",
      linkedResourceId: payment?.id || null
    },
    null
  );
}

// Not a toggleable trigger: a paid payment that needs staff action (e.g. the
// ZATCA invoice could not be issued because the branch VAT number is not
// configured). Always created -- money was taken.
async function createTaskForPaymentIssue(payment, message) {
  if (!payment?.branch_id) {
    return null;
  }
  return taskRepository.createTask(
    {
      branchId: payment.branch_id,
      title: `Payment needs attention: #${payment.id}`,
      description: message,
      assignedTo: null,
      dueDate: null,
      priority: "urgent",
      linkedResourceType: "payment",
      linkedResourceId: payment.id
    },
    null
  );
}

module.exports = {
  createTaskForExpiringMembership,
  createTaskForFailedPayment,
  createTaskForPaymentIssue,
  createTaskForNewLead
};
