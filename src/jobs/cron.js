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

async function renewalReminders() {
  if (!hasDatabaseConfig()) return;

  const rows = await query(
    `SELECT id, user_id
     FROM memberships
     WHERE end_date = UTC_DATE() + INTERVAL 7 DAY AND status = 'active'`
  );

  await Promise.all(
    rows.map((row) =>
      query(
        `INSERT INTO notifications (user_id, type, title_ar, title_en, body_ar, body_en)
         VALUES (?, 'renewal_reminder', ?, ?, ?, ?)`,
        [
          row.user_id,
          "تذكير بتجديد العضوية",
          "Membership renewal reminder",
          "تبقى 7 أيام على انتهاء عضويتك.",
          "Your membership expires in 7 days."
        ]
      )
    )
  );
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
