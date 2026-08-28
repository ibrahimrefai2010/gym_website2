const { getPool, hasDatabaseConfig, query } = require("../config/database");

const plans = [
  ["شهر واحد", "1 Month + 7 Days Extra", "دخول مناسب للتدريب المنتظم باستقلالية.", "Access for consistent independent training.", 30, 7, 349, 550, 1, 0, 1],
  ["3 اشهر", "3 Months", "عضوية بإشراف تدريبي لتحقيق تقدم واضح.", "Coaching-led membership for measurable progress.", 90, 0, 849, 1656, 1, 1, 2],
  ["6 اشهر", "6 Months", "إشراف شخصي وخدمة تدريب خاصة.", "High-touch coaching and private training support.", 180, 0, 1399, 2651, 1, 0, 3],
  ["12 اشهر", "12 Months", "إشراف شخصي وخدمة تدريب خاصة.", "High-touch coaching and private training support.", 365, 0, 1849, 5037, 1, 0, 4]
];

const settings = [
  ["gym_name_en", "Muscle and Fitness Center", "string", "Gym name (English)", "اسم الصالة (إنجليزي)"],
  ["gym_name_ar", "مركز بناء ولياقة الرياضي", "string", "Gym name (Arabic)", "اسم الصالة (عربي)"],
  ["whatsapp_number", "966569919944", "string", "WhatsApp number", "رقم واتساب"],
  ["phone_number", "+966569919944", "string", "Phone number", "رقم الهاتف"],
  ["google_maps_url", "https://maps.google.com/?q=Hyper+Panda+Roundabout+Jizan+Saudi+Arabia", "string", "Google Maps URL", "رابط الخريطة"],
  ["working_hours_ar", "السبت - الخميس: 6ص - 11م  |  الجمعة: 4م - 11م", "string", "Working hours (AR)", "ساعات العمل (عربي)"],
  ["working_hours_en", "Sat - Thu: 6AM - 11PM  |  Fri: 4PM - 11PM", "string", "Working hours (EN)", "Working hours (English)"],
  ["membership_activation_mode", "manual", "string", "Activation mode (auto/manual)", "طريقة التفعيل"]
];

async function seed() {
  if (!hasDatabaseConfig()) {
    throw new Error("Set DB_HOST, DB_USER, and DB_NAME or DATABASE_URL before running db:seed.");
  }

  for (const setting of settings) {
    await query(
      `INSERT INTO settings (key_name, value, type, label_en, label_ar)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), type = VALUES(type), label_en = VALUES(label_en), label_ar = VALUES(label_ar)`,
      setting
    );
  }

  for (const plan of plans) {
    const existing = await query(
      `SELECT id FROM plans
       WHERE deleted_at IS NULL AND (name_en = ? OR sort_order = ?)
       ORDER BY name_en = ? DESC, id ASC
       LIMIT 1`,
      [plan[1], plan[10], plan[1]]
    );
    if (existing[0]) {
      await query(
        `UPDATE plans
         SET name_ar = ?, name_en = ?, description_ar = ?, description_en = ?, duration_days = ?, bonus_days = ?,
           price = ?, original_price = ?, is_active = ?, is_featured = ?, sort_order = ?, deleted_at = NULL,
           updated_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [plan[0], plan[1], plan[2], plan[3], plan[4], plan[5], plan[6], plan[7], plan[8], plan[9], plan[10], existing[0].id]
      );
    } else {
      await query(
        `INSERT INTO plans (name_ar, name_en, description_ar, description_en, duration_days, bonus_days, price, original_price, is_active, is_featured, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        plan
      );
    }
  }

  process.stdout.write("Database seed completed.\n");
}

seed()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    const pool = getPool();
    if (pool) {
      await pool.end();
    }
  });
