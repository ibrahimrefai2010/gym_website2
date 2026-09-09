const cron = require("node-cron");
const { hasDatabaseConfig, query } = require("../config/database");
const tokenRepository = require("../repositories/tokenRepository");
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
    const rows = await query(
      `SELECT id, user_id
       FROM memberships
       WHERE end_date = UTC_DATE() + INTERVAL ? DAY AND status = 'active'`,
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
  cleanExpiredOtps,
  expireMemberships,
  renewalReminders
};
