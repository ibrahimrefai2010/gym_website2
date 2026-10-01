const cron = require("node-cron");
const { hasDatabaseConfig, query } = require("../config/database");
const tokenRepository = require("../repositories/tokenRepository");
const taskService = require("../services/taskService");
const paymentService = require("../services/paymentService");
const backupService = require("../services/backupService");
const customerRepository = require("../repositories/customerRepository");
const membershipRepository = require("../repositories/membershipRepository");
const settingsRepository = require("../repositories/settingsRepository");
const { appLogger } = require("../utils/logger");
const { env } = require("../config/env");

async function expireMemberships() {
  if (!hasDatabaseConfig()) return;

  const rows = await query(
    `SELECT id, user_id
     FROM memberships
     WHERE end_date < UTC_DATE() AND status = 'active'`
  );

  if (rows.length === 0) return;

  await Promise.all(
    rows.map((row) =>
      query("UPDATE memberships SET status = 'expired', updated_at = UTC_TIMESTAMP() WHERE id = ?", [row.id])
    )
  );

  await Promise.all(
    rows.map((row) =>
      query(
        `INSERT INTO notifications (user_id, type, title_ar, title_en, body_ar, body_en)
         VALUES (?, 'membership_expired', ?, ?, ?, ?)`,
        [
          row.user_id,
          "انتهت عضويتك",
          "Your membership expired",
          "انتهت عضويتك في مركز بناء ولياقة الرياضي. يرجى التجديد للاستمرار.",
          "Your Muscle and Fitness Center membership has expired. Please renew to continue."
        ]
      )
    )
  );
}

// Renewal reminders fire once at 7, 3, and 1 day before expiry. The job runs
// daily and each membership crosses each threshold on exactly one day, so no
// de-duplication is needed.
const RENEWAL_REMINDER_DAYS = [7, 3, 1];

function renewalReminderCopy(days) {
  if (days === 1) {
    return {
      titleAr: "تذكير أخير بتجديد العضوية",
      titleEn: "Final membership renewal reminder",
      bodyAr: "يتبقى يوم واحد على انتهاء عضويتك. جدّد الآن لتفادي انقطاع الوصول.",
      bodyEn: "Your membership expires tomorrow. Renew now to avoid a gap in access."
    };
  }
  return {
    titleAr: "تذكير بتجديد العضوية",
    titleEn: "Membership renewal reminder",
    bodyAr: `تبقى ${days} أيام على انتهاء عضويتك.`,
    bodyEn: `Your membership expires in ${days} days.`
  };
}

async function renewalReminders() {
  if (!hasDatabaseConfig()) return;

  for (const days of RENEWAL_REMINDER_DAYS) {
    // branch_id/full_name/plan name are pulled here (not re-queried inside
    // taskService) purely so the auto-created task's title/description can
    // reference the member and plan by name -- see
    // taskService.createTaskForExpiringMembership, the Tasks/Follow-ups
    // auto-generation hook for this same 7/3/1-day trigger.
    const rows = await query(
      `SELECT m.id, m.user_id, m.branch_id, m.end_date, u.full_name AS user_full_name, p.name_en AS plan_name
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN plans p ON p.id = m.plan_id
       WHERE m.end_date = UTC_DATE() + INTERVAL ? DAY AND m.status = 'active'`,
      [days]
    );
    if (rows.length === 0) continue;

    const copy = renewalReminderCopy(days);
    await Promise.all(
      rows.map((row) =>
        query(
          `INSERT INTO notifications (user_id, type, title_ar, title_en, body_ar, body_en)
           VALUES (?, 'renewal_reminder', ?, ?, ?, ?)`,
          [row.user_id, copy.titleAr, copy.titleEn, copy.bodyAr, copy.bodyEn]
        )
      )
    );

    // Tasks/Follow-ups auto-generation trigger 1: one follow-up task per
    // membership crossing this threshold, gated by the branch's
    // task_autogen_expiring_memberships setting (defaults to enabled -- see
    // taskService.js). Best-effort: a failure here must never break the
    // notification insert above or the rest of the cron run.
    await Promise.all(
      rows.map((row) =>
        taskService
          .createTaskForExpiringMembership(
            {
              id: row.id,
              userId: row.user_id,
              branchId: row.branch_id,
              endDate: row.end_date,
              userFullName: row.user_full_name,
              planName: row.plan_name
            },
            days
          )
          .catch((error) => appLogger.error({ error, membershipId: row.id }, "Task autogen (expiring membership) failed"))
      )
    );
  }
}

async function cleanExpiredOtps() {
  if (!hasDatabaseConfig()) return;
  await tokenRepository.cleanExpiredOtps();
}

cron.schedule(
  "0 2 * * *",
  async () => {
    try {
      await expireMemberships();
    } catch (error) {
      appLogger.error({ error }, "Membership expiry cron failed");
    }
  },
  { timezone: env.timezone }
);

cron.schedule(
  "0 9 * * *",
  async () => {
    try {
      await renewalReminders();
    } catch (error) {
      appLogger.error({ error }, "Renewal reminder cron failed");
    }
  },
  { timezone: env.timezone }
);

// At-risk members: one follow-up task per inactive member per branch
// (taskService de-duplicates), and freezes whose window passed are closed.
async function atRiskMembers() {
  if (!hasDatabaseConfig()) return;
  await membershipRepository.completeEndedFreezes();
  const branches = await query("SELECT id FROM branches WHERE status = 'active' AND deleted_at IS NULL");
  for (const branch of branches) {
    const days = Number(await settingsRepository.getSetting("member_inactivity_days", 14, branch.id)) || 14;
    const members = await customerRepository.listAtRiskMembers(branch.id, days);
    for (const member of members) {
      await taskService
        .createTaskForAtRiskMember(member, branch.id, days)
        .catch((error) => appLogger.error({ error, userId: member.id }, "Task autogen (at-risk member) failed"));
    }
  }
}

cron.schedule(
  "30 9 * * *",
  async () => {
    try {
      await atRiskMembers();
    } catch (error) {
      appLogger.error({ error }, "At-risk member cron failed");
    }
  },
  { timezone: env.timezone }
);

// Scheduled database backup (BACKUP_CRON, e.g. "0 3 * * *" = 03:00 Riyadh).
if (env.backupCron && cron.validate(env.backupCron)) {
  cron.schedule(
    env.backupCron,
    async () => {
      try {
        await backupService.createBackup({ source: "schedule" });
      } catch (error) {
        appLogger.error({ error: error.message, details: error.details }, "Scheduled backup failed");
      }
    },
    { timezone: env.timezone }
  );
}

// Moyasar safety net: settles pending online payments whose webhook was
// missed and closes abandoned checkouts (see paymentService.finalizeMoyasarPayment).
cron.schedule(
  "*/10 * * * *",
  async () => {
    try {
      await paymentService.reconcileMoyasarPayments();
    } catch (error) {
      appLogger.error({ error }, "Moyasar reconcile cron failed");
    }
  },
  { timezone: env.timezone }
);

cron.schedule(
  "0 * * * *",
  async () => {
    try {
      await cleanExpiredOtps();
    } catch (error) {
      appLogger.error({ error }, "OTP cleanup cron failed");
    }
  },
  { timezone: env.timezone }
);

module.exports = {
  atRiskMembers,
  cleanExpiredOtps,
  expireMemberships,
  renewalReminders
};
