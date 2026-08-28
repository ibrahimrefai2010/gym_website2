// Idempotent demo content: one member with a populated portal (membership,
// history, a payment, notifications, profile + emergency contact) so every
// section of the member area shows real data on a fresh demo instance.
const { getPool, hasDatabaseConfig, query } = require("../src/config/database");
const { hashPassword } = require("../src/utils/hash");

const DEMO_EMAIL = "demo@muscle-fitness.local";
const DEMO_PASSWORD = "Demo@12345";

async function tableExists(name) {
  const rows = await query(
    "SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [name]
  );
  return Number(rows[0]?.c || 0) > 0;
}

async function seedDemo() {
  if (!hasDatabaseConfig()) {
    throw new Error("Database is not configured.");
  }

  const existing = await query("SELECT id FROM users WHERE email = ? LIMIT 1", [DEMO_EMAIL]);
  if (existing[0]) {
    process.stdout.write(`Demo member already present (user #${existing[0].id}).\n`);
    return;
  }

  const planRows = await query(
    "SELECT id FROM plans WHERE deleted_at IS NULL ORDER BY sort_order ASC, id ASC LIMIT 2"
  );
  if (!planRows[0]) {
    process.stdout.write("No plans found; run db:seed first. Skipping demo member.\n");
    return;
  }
  const planA = planRows[0].id;
  const planB = (planRows[1] || planRows[0]).id;

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const userResult = await query(
    `INSERT INTO users (full_name, email, phone, password_hash, status)
     VALUES ('Demo Member', ?, '0500000000', ?, 'active')`,
    [DEMO_EMAIL, passwordHash]
  );
  const userId = userResult.insertId;

  await query(
    `UPDATE users
     SET member_code = CONCAT('MFC-', LPAD(id, 6, '0')),
         card_token = REPLACE(UUID(), '-', '')
     WHERE id = ?`,
    [userId]
  );

  if (await tableExists("customer_profiles")) {
    await query(
      `INSERT INTO customer_profiles (user_id, national_id, gender, birth_date, nationality, city, country)
       VALUES (?, '1099887766', 'male', '1996-03-12', 'Saudi', 'Jizan', 'Saudi Arabia')`,
      [userId]
    );
  }

  if (await tableExists("emergency_contacts")) {
    await query(
      `INSERT INTO emergency_contacts (user_id, name, phone, relationship, is_primary)
       VALUES (?, 'Layla', '0555555555', 'Sister', 1)`,
      [userId]
    );
  }

  const activeMembership = await query(
    `INSERT INTO memberships (user_id, plan_id, status, start_date, end_date)
     VALUES (?, ?, 'active', DATE_SUB(UTC_DATE(), INTERVAL 20 DAY), DATE_ADD(UTC_DATE(), INTERVAL 25 DAY))`,
    [userId, planA]
  );

  await query(
    `INSERT INTO memberships (user_id, plan_id, status, start_date, end_date)
     VALUES (?, ?, 'expired', DATE_SUB(UTC_DATE(), INTERVAL 210 DAY), DATE_SUB(UTC_DATE(), INTERVAL 115 DAY))`,
    [userId, planB]
  );

  const planPrice = await query("SELECT price FROM plans WHERE id = ? LIMIT 1", [planA]);
  const amount = Number(planPrice[0]?.price || 349);

  await query(
    `INSERT INTO payments (user_id, membership_id, provider, payment_method, transaction_id, amount, currency, status, completed_at)
     VALUES (?, ?, 'manual', 'cash', 'DEMO-0001', ?, 'SAR', 'completed', DATE_SUB(UTC_TIMESTAMP(), INTERVAL 20 DAY))`,
    [userId, activeMembership.insertId, amount]
  );

  const notifications = [
    [
      "announcement",
      "جدول الحصص الجديد",
      "New group class schedule",
      "بدأ العمل بجدول حصص جديد. اطّلع على المواعيد من الاستقبال.",
      "A new group class schedule is now live. Check the times at reception.",
      0
    ],
    [
      "payment_succeeded",
      "تم استلام دفعتك",
      "Payment received",
      `تم استلام دفعتك بمبلغ SAR ${amount.toFixed(2)} بنجاح.`,
      `We received your payment of SAR ${amount.toFixed(2)} successfully.`,
      1
    ],
    [
      "renewal_reminder",
      "تذكير بتجديد العضوية",
      "Membership renewal reminder",
      "تقترب عضويتك من الانتهاء. جدّد الآن لتفادي انقطاع الدخول.",
      "Your membership is approaching its end date. Renew now to avoid a gap.",
      0
    ]
  ];

  for (let dayOffset = 0; dayOffset < notifications.length; dayOffset += 1) {
    const [type, titleAr, titleEn, bodyAr, bodyEn, isRead] = notifications[dayOffset];
    await query(
      `INSERT INTO notifications (user_id, type, title_ar, title_en, body_ar, body_en, is_read, read_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ${isRead ? "UTC_TIMESTAMP()" : "NULL"}, DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY))`,
      [userId, type, titleAr, titleEn, bodyAr, bodyEn, isRead, dayOffset]
    );
  }

  if (await tableExists("notification_preferences")) {
    await query(
      "INSERT INTO notification_preferences (user_id, email_transactional) VALUES (?, 1) ON DUPLICATE KEY UPDATE user_id = user_id",
      [userId]
    );
  }

  process.stdout.write(`Created demo member #${userId} (${DEMO_EMAIL} / ${DEMO_PASSWORD}).\n`);
}

seedDemo()
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    const pool = getPool();
    if (pool) {
      await pool.end();
    }
  });
