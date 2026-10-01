// STAGING / DEMO DATA ONLY -- never run against production.
//
// Fills BOTH branches with realistic demo data so every admin screen and the
// public sites have something to show: plan features, coaches, FAQs (one
// shared + one per branch), members in every state (active, expiring soon,
// expired, frozen, at-risk, no membership), check-ins, leads, a paid
// reception payment with its ZATCA invoice, and follow-up tasks.
//
// Idempotent: every seeded member/lead/coach is keyed by a "@staging.local"
// email or "[staging]" marker and skipped if it already exists.
//
//   npm run db:seed:staging
//
// Demo member password for every seeded member: Staging@12345

const { getPool, hasDatabaseConfig, query } = require("../src/config/database");
const { env } = require("../src/config/env");

const PASSWORD = "Staging@12345";
const BRANCHES = ["main", "women"];

const FEATURES = {
  default: { en: ["Full gym floor access", "Locker & showers", "Body composition check"], ar: ["دخول كامل لصالة التدريب", "خزائن ودشات", "فحص تكوين الجسم"] },
  long: { en: ["Full gym floor access", "Locker & showers", "Body composition check", "Monthly coach review", "Freeze up to 14 days"], ar: ["دخول كامل لصالة التدريب", "خزائن ودشات", "فحص تكوين الجسم", "مراجعة شهرية مع المدرب", "تجميد حتى 14 يومًا"] }
};

const COACHES = {
  main: [
    { en: "Khalid Alharbi", ar: "خالد الحربي", specEn: "Strength & conditioning", specAr: "القوة واللياقة", years: 9 },
    { en: "Faisal Almutairi", ar: "فيصل المطيري", specEn: "Fat loss coaching", specAr: "تدريب خسارة الدهون", years: 6 }
  ],
  women: [
    { en: "Noura Alqahtani", ar: "نورة القحطاني", specEn: "Functional fitness", specAr: "اللياقة الوظيفية", years: 7 },
    { en: "Reem Alshehri", ar: "ريم الشهري", specEn: "Pre & postnatal fitness", specAr: "لياقة ما قبل وبعد الولادة", years: 5 }
  ]
};

// [label, state, membership end offset (days), last visit (days ago | null)]
const MEMBERS = [
  ["Active", "active", 45, 1],
  ["Expiring", "active", 2, 3],
  ["AtRisk", "active", 30, 25],
  ["Expired", "expired", -12, 20],
  ["Frozen", "frozen", 40, 9],
  ["Prospect", "none", null, null]
];

async function branchId(code) {
  const rows = await query("SELECT id FROM branches WHERE code = ? LIMIT 1", [code]);
  if (!rows[0]) throw new Error(`Branch '${code}' not found -- run migrations and db:seed first.`);
  return Number(rows[0].id);
}

async function seedPlanFeatures(id) {
  const plans = await query("SELECT id, duration_days FROM plans WHERE branch_id = ? AND deleted_at IS NULL AND (features IS NULL OR JSON_LENGTH(JSON_EXTRACT(features, '$.en')) = 0)", [id]);
  for (const plan of plans) {
    const features = Number(plan.duration_days) >= 90 ? FEATURES.long : FEATURES.default;
    await query("UPDATE plans SET features = ? WHERE id = ?", [JSON.stringify(features), plan.id]);
  }
  return plans.length;
}

async function seedCoaches(code, id) {
  let added = 0;
  for (const [index, coach] of COACHES[code].entries()) {
    const exists = await query("SELECT id FROM coaches WHERE branch_id = ? AND name_en = ? AND deleted_at IS NULL LIMIT 1", [id, coach.en]);
    if (exists[0]) continue;
    await query(
      `INSERT INTO coaches (branch_id, name_en, name_ar, specialty_en, specialty_ar, bio_en, bio_ar, years_experience, is_active, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [id, coach.en, coach.ar, coach.specEn, coach.specAr, `[staging] ${coach.specEn} coach.`, `[staging] مدرب ${coach.specAr}.`, coach.years, index + 1]
    );
    added += 1;
  }
  return added;
}

async function seedFaqs(code, id) {
  const rows = [
    [null, "Do you offer a free trial visit? [staging]", "هل يوجد زيارة تجريبية مجانية؟ [تجريبي]", "Yes — one guided visit with a coach. Contact us on WhatsApp to book.", "نعم — زيارة واحدة بإشراف مدرب. تواصل معنا عبر واتساب للحجز."],
    code === "women"
      ? [id, "Is the women's branch fully private? [staging]", "هل الفرع النسائي خاص بالكامل؟ [تجريبي]", "Yes. The branch is women-only with an all-female team.", "نعم. الفرع للنساء فقط وفريق العمل نسائي بالكامل."]
      : [id, "Is parking available? [staging]", "هل يتوفر موقف سيارات؟ [تجريبي]", "Yes, free parking in front of the club.", "نعم، موقف مجاني أمام النادي."]
  ];
  let added = 0;
  for (const [branch, qEn, qAr, aEn, aAr] of rows) {
    const exists = await query("SELECT id FROM faqs WHERE question_en = ? AND deleted_at IS NULL LIMIT 1", [qEn]);
    if (exists[0]) continue;
    await query("INSERT INTO faqs (branch_id, question_en, question_ar, answer_en, answer_ar, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)", [branch, qEn, qAr, aEn, aAr, 50 + added]);
    added += 1;
  }
  return added;
}

async function seedMembers(code, id) {
  const userRepository = require("../src/repositories/userRepository");
  const [plan] = await query("SELECT id, price FROM plans WHERE branch_id = ? AND deleted_at IS NULL AND is_active = 1 ORDER BY sort_order LIMIT 1", [id]);
  if (!plan) return 0;
  let added = 0;
  for (const [index, [label, state, endOffset, lastVisit]] of MEMBERS.entries()) {
    const email = `${label.toLowerCase()}.${code}@staging.local`;
    if ((await query("SELECT id FROM users WHERE branch_id = ? AND email = ? LIMIT 1", [id, email]))[0]) continue;
    const user = await userRepository.createUser({
      branchId: id,
      fullName: `${label} ${code === "women" ? "Member (W)" : "Member"}`,
      email,
      phone: `05${code === "women" ? "4" : "3"}${String(9000000 + index).padStart(7, "0")}`,
      password: PASSWORD
    });
    if (state !== "none") {
      const status = state === "expired" ? "expired" : "active";
      const res = await query(
        "INSERT INTO memberships (branch_id, user_id, plan_id, status, start_date, end_date) VALUES (?, ?, ?, ?, UTC_DATE() - INTERVAL 30 DAY, UTC_DATE() + INTERVAL ? DAY)",
        [id, user.id, plan.id, status, endOffset]
      );
      if (state === "frozen") {
        await query(
          `INSERT INTO membership_freezes (branch_id, membership_id, user_id, reason, starts_on, ends_on, extension_days, status)
           VALUES (?, ?, ?, '[staging] Travelling', UTC_DATE() - INTERVAL 2 DAY, UTC_DATE() + INTERVAL 7 DAY, 10, 'active')`,
          [id, res.insertId, user.id]
        );
      }
      if (lastVisit !== null) {
        for (let n = 0; n < 6; n += 1) {
          await query(
            `INSERT INTO attendance_logs (branch_id, user_id, membership_id, check_in_at, check_out_at, method, status)
             VALUES (?, ?, ?, UTC_TIMESTAMP() - INTERVAL ? DAY - INTERVAL ? HOUR, UTC_TIMESTAMP() - INTERVAL ? DAY - INTERVAL ? HOUR + INTERVAL 75 MINUTE, 'qr', 'checked_out')`,
            [id, user.id, res.insertId, lastVisit + n * 3, 2 + (n % 5), lastVisit + n * 3, 2 + (n % 5)]
          );
        }
      }
    }
    added += 1;
  }
  return added;
}

async function seedPaymentAndInvoice(code, id) {
  const email = `paid.${code}@staging.local`;
  if ((await query("SELECT id FROM users WHERE branch_id = ? AND email = ? LIMIT 1", [id, email]))[0]) return 0;
  const userRepository = require("../src/repositories/userRepository");
  const paymentService = require("../src/services/paymentService");
  const [plan] = await query("SELECT id FROM plans WHERE branch_id = ? AND deleted_at IS NULL AND is_active = 1 ORDER BY sort_order LIMIT 1", [id]);
  const [admin] = await query("SELECT id FROM admin_users WHERE deleted_at IS NULL ORDER BY role = 'super_admin' DESC, id LIMIT 1");
  if (!plan) return 0;
  const user = await userRepository.createUser({ branchId: id, fullName: `Paid ${code === "women" ? "Member (W)" : "Member"}`, email, phone: `05${code === "women" ? "4" : "3"}8888888`, password: PASSWORD });
  try {
    await paymentService.recordManualPayment(admin ? admin.id : null, id, { userId: user.id, planId: plan.id, method: "cash", idempotencyKey: `staging-${code}-paid-member`, reference: "[staging]" });
  } catch (error) {
    console.warn(`  payment for ${code} skipped: ${error.message}`);
  }
  return 1;
}

async function seedLeadsAndTasks(code, id) {
  const exists = await query("SELECT id FROM messages WHERE branch_id = ? AND email = ? LIMIT 1", [id, `lead.${code}@staging.local`]);
  if (exists[0]) return 0;
  const lead = await query(
    "INSERT INTO messages (branch_id, name, email, phone, subject, message, status, lead_status) VALUES (?, ?, ?, '0551234000', 'Membership prices', '[staging] Interested in a 3-month plan.', 'unread', 'new')",
    [id, `Lead ${code === "women" ? "(W)" : ""}`.trim(), `lead.${code}@staging.local`]
  );
  await query(
    "INSERT INTO tasks (branch_id, title, description, priority, status, linked_resource_type, linked_resource_id) VALUES (?, ?, '[staging] Call back about pricing.', 'medium', 'open', 'message', ?)",
    [id, "Follow up new lead [staging]", lead.insertId]
  );
  return 1;
}

async function main() {
  if (env.nodeEnv === "production") {
    console.error("Refusing to seed demo data with NODE_ENV=production.");
    process.exit(1);
  }
  if (!hasDatabaseConfig()) {
    console.error("No database configured (.env).");
    process.exit(1);
  }
  for (const code of BRANCHES) {
    const id = await branchId(code);
    console.log(`[${code}] branch ${id}`);
    console.log(`  plan features: ${await seedPlanFeatures(id)}`);
    console.log(`  coaches: +${await seedCoaches(code, id)}`);
    console.log(`  faqs: +${await seedFaqs(code, id)}`);
    console.log(`  members: +${await seedMembers(code, id)}`);
    console.log(`  paid member + invoice: +${await seedPaymentAndInvoice(code, id)}`);
    console.log(`  leads + tasks: +${await seedLeadsAndTasks(code, id)}`);
  }
  console.log(`Done. Seeded members sign in with password ${PASSWORD} (emails: <state>.<branch>@staging.local).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const pool = getPool();
    if (pool) await pool.end();
    const cron = require("node-cron");
    for (const [, task] of cron.getTasks()) {
      task.stop();
      task.destroy();
    }
  });
