const { getPool, hasDatabaseConfig, query } = require("../config/database");

// ---------------------------------------------------------------------------
// Main Branch (branch_id 1) reference content.
// ---------------------------------------------------------------------------

const mainPlans = [
  ["شهر واحد", "1 Month + 7 Days Extra", "دخول مناسب للتدريب المنتظم باستقلالية.", "Access for consistent independent training.", 30, 7, 349, 550, 1, 0, 1],
  ["3 اشهر", "3 Months", "عضوية بإشراف تدريبي لتحقيق تقدم واضح.", "Coaching-led membership for measurable progress.", 90, 0, 849, 1656, 1, 1, 2],
  ["6 اشهر", "6 Months", "إشراف شخصي وخدمة تدريب خاصة.", "High-touch coaching and private training support.", 180, 0, 1399, 2651, 1, 0, 3],
  ["12 اشهر", "12 Months", "إشراف شخصي وخدمة تدريب خاصة.", "High-touch coaching and private training support.", 365, 0, 1849, 5037, 1, 0, 4]
];

// The full key list a branch's `settings` row-set should have. The first 8
// keys were already being seeded (DB rows); site_logo_url..social_share_image_url
// previously existed only as code-level fallbacks in settingsRepository.js's
// `fallbackSettings`/`publicKeys` (never an actual DB row for any branch).
// Now that `settings` is branch-scoped (migration
// 202609180002_settings_branch_scope), both branches get explicit rows for
// every key so Admin > Settings can show/edit them per branch.
const mainSettings = [
  ["gym_name_en", "Muscle and Fitness Center", "string", "Gym name (English)", "اسم الصالة (إنجليزي)"],
  ["gym_name_ar", "مركز بناء ولياقة الرياضي", "string", "Gym name (Arabic)", "اسم الصالة (عربي)"],
  ["whatsapp_number", "966569919944", "string", "WhatsApp number", "رقم واتساب"],
  ["phone_number", "+966569919944", "string", "Phone number", "رقم الهاتف"],
  ["google_maps_url", "https://maps.google.com/?q=Hyper+Panda+Roundabout+Jizan+Saudi+Arabia", "string", "Google Maps URL", "رابط الخريطة"],
  ["working_hours_ar", "السبت - الخميس: 6ص - 11م  |  الجمعة: 4م - 11م", "string", "Working hours (AR)", "ساعات العمل (عربي)"],
  ["working_hours_en", "Sat - Thu: 6AM - 11PM  |  Fri: 4PM - 11PM", "string", "Working hours (EN)", "Working hours (English)"],
  ["membership_activation_mode", "manual", "string", "Activation mode (auto/manual)", "طريقة التفعيل"],
  ["site_logo_url", "/assets/logo.png", "string", "Site logo URL", "شعار الموقع"],
  ["home_hero_image_url", "/assets/images/hero-gym.webp", "string", "Home hero image URL", "صورة الغلاف الرئيسية"],
  ["home_hero_fallback_image_url", "/assets/images/hero-gym.png", "string", "Home hero fallback image URL", "صورة الغلاف الاحتياطية"],
  ["auth_hero_image_url", "/assets/images/hero-gym.webp", "string", "Login hero image URL", "صورة غلاف الدخول"],
  ["auth_hero_fallback_image_url", "/assets/images/hero-gym.png", "string", "Login hero fallback image URL", "صورة غلاف الدخول الاحتياطية"],
  ["social_share_image_url", "/assets/images/hero-gym.png", "string", "Social share image URL", "صورة المشاركة الاجتماعية"]
];

// ---------------------------------------------------------------------------
// Women's Branch content. Branch id is resolved at runtime by `code = 'women'`
// (never hardcoded/assumed) -- see resolveWomenBranchId() below.
// ---------------------------------------------------------------------------

const womenSettings = [
  ["gym_name_en", "Muscle and Fitness Center — Women's Branch", "string", "Gym name (English)", "اسم الصالة (إنجليزي)"],
  ["gym_name_ar", "مركز بناء ولياقة الرياضي - الفرع النسائي", "string", "Gym name (Arabic)", "اسم الصالة (عربي)"],
  ["whatsapp_number", "966569919955", "string", "WhatsApp number", "رقم واتساب"],
  ["phone_number", "+966569919955", "string", "Phone number", "رقم الهاتف"],
  ["google_maps_url", "https://maps.google.com/?q=Women%27s+Fitness+Center+Jizan+Saudi+Arabia", "string", "Google Maps URL", "رابط الخريطة"],
  ["working_hours_ar", "السبت - الخميس: 9ص - 9م  |  الجمعة: مغلقة", "string", "Working hours (AR)", "ساعات العمل (عربي)"],
  ["working_hours_en", "Sat - Thu: 9AM - 9PM  |  Fri: Closed", "string", "Working hours (EN)", "Working hours (English)"],
  ["membership_activation_mode", "manual", "string", "Activation mode (auto/manual)", "طريقة التفعيل"],
  // Placeholder imagery: reuses the existing Main-branch asset files
  // (public/assets/images/hero-gym.*, public/assets/logo.png) since no real
  // Women's-branch photography/branding exists yet.
  // TODO before going live: replace with dedicated Women's-branch hero/logo
  // assets and drop them into public/assets/images/.
  ["site_logo_url", "/assets/logo.png", "string", "Site logo URL", "شعار الموقع"],
  ["home_hero_image_url", "/assets/images/hero-gym.webp", "string", "Home hero image URL", "صورة الغلاف الرئيسية"],
  ["home_hero_fallback_image_url", "/assets/images/hero-gym.png", "string", "Home hero fallback image URL", "صورة الغلاف الاحتياطية"],
  ["auth_hero_image_url", "/assets/images/hero-gym.webp", "string", "Login hero image URL", "صورة غلاف الدخول"],
  ["auth_hero_fallback_image_url", "/assets/images/hero-gym.png", "string", "Login hero fallback image URL", "صورة غلاف الدخول الاحتياطية"],
  ["social_share_image_url", "/assets/images/hero-gym.png", "string", "Social share image URL", "صورة المشاركة الاجتماعية"]
];

// section_key list mirrors fallbackData.js's homepage.{hero,about,coaching} --
// those are the only sections Main branch has (it has zero DB rows for
// homepage_text; the public site runs off fallbackData.js for them today).
const womenHomepageText = [
  {
    sectionKey: "hero",
    titleEn: "Train With Confidence, In Complete Privacy.",
    titleAr: "تدربي بثقة، في خصوصية تامة.",
    bodyEn: "A women-only training environment designed for comfort, focus, and real results.",
    bodyAr: "بيئة تدريب مخصصة للسيدات فقط، صُممت لتمنحك الراحة والتركيز ونتائج حقيقية."
  },
  {
    sectionKey: "about",
    titleEn: "A Space Built Around You.",
    titleAr: "مساحة صُممت من أجلك.",
    bodyEn: "From the layout to the schedule, every detail of the Women's Branch is designed for a private, welcoming training experience.",
    bodyAr: "من التصميم إلى الجدول الزمني، كل تفصيلة في الفرع النسائي صُممت لتمنحك تجربة تدريب خاصة ومريحة."
  },
  {
    sectionKey: "coaching",
    titleEn: "Guided by Certified Female Coaches.",
    titleAr: "بإشراف مدربات معتمدات.",
    bodyEn: "Every program is led by certified female coaches, ensuring a supportive and professional training journey.",
    bodyAr: "كل برنامج تدريبي تشرف عليه مدربات معتمدات، لضمان رحلة تدريب داعمة واحترافية."
  }
];

// Placeholder imagery only -- reuses Main branch's existing offer-* assets
// (no real Women's-branch photography exists yet). TODO before going live:
// replace image_url/fallback_image_url with dedicated Women's-branch photos.
const womenSlides = [
  {
    imageUrl: "/assets/images/offer-seasonal.webp",
    fallbackImageUrl: "/assets/images/offer-seasonal.png",
    titleEn: "New Season, New Goals",
    titleAr: "موسم جديد، أهداف جديدة",
    bodyEn: "Join the Women's Branch this season with preferred rates for new members.",
    bodyAr: "انضمي إلى الفرع النسائي هذا الموسم بأسعار مميزة للأعضاء الجدد.",
    sortOrder: 1
  },
  {
    imageUrl: "/assets/images/offer-coaching.webp",
    fallbackImageUrl: "/assets/images/offer-coaching.png",
    titleEn: "Personal Coaching, Just for You",
    titleAr: "تدريب شخصي، خاص بك",
    bodyEn: "Work one-on-one with certified female coaches on a plan built around your goals.",
    bodyAr: "تدربي بشكل فردي مع مدربات معتمدات ضمن خطة مبنية على أهدافك.",
    sortOrder: 2
  },
  {
    imageUrl: "/assets/images/offer-recovery.webp",
    fallbackImageUrl: "/assets/images/offer-recovery.png",
    titleEn: "Recovery Matters Too",
    titleAr: "التعافي مهم أيضاً",
    bodyEn: "Mobility and recovery guidance are built into every Women's Branch membership.",
    bodyAr: "إرشادات المرونة والتعافي جزء أساسي من كل عضوية في الفرع النسائي.",
    sortOrder: 3
  }
];

// Pricing stays in the same rough SAR range as Main branch's plans above.
// No `features` column exists on `plans` (DB-backed plans always render
// features: { en: [], ar: [] } -- see planRepository.mapPlan; only
// fallbackData.js's hardcoded demo plans carry a features list). That's a
// pre-existing limitation, not something introduced here.
const womenPlans = [
  ["شهر واحد", "1 Month", "دخول للتدريب المستقل في بيئة نسائية خاصة بالكامل.", "Independent training access in a fully private, women-only setting.", 30, 0, 379, 450, 1, 0, 1],
  ["3 اشهر", "3 Months", "عضوية بإشراف تدريبي لتحقيق تقدم ملموس.", "Coaching-led membership for measurable progress.", 90, 0, 899, 1350, 1, 1, 2],
  ["6 اشهر", "6 Months", "إشراف شخصي من مدربات معتمدات.", "Personal supervision from certified female coaches.", 180, 0, 1449, 2700, 1, 0, 3],
  ["12 اشهر", "12 Months", "إشراف شخصي وخدمة تدريب خاصة على مدار العام.", "Year-round personal coaching and dedicated support.", 365, 0, 1899, 5400, 1, 0, 4]
];

const womenOffers = [
  {
    titleEn: "New Member Welcome Offer",
    titleAr: "عرض ترحيبي للعضوات الجدد",
    bodyEn: "Preferred monthly pricing for the first members to join the Women's Branch.",
    bodyAr: "سعر شهري مميز لأوائل العضوات المنضمات إلى الفرع النسائي.",
    imageUrl: "/assets/images/offer-seasonal.webp",
    discountValue: 15,
    badgeEn: "Limited",
    badgeAr: "محدود",
    expiresAt: "2026-12-31 23:59:59",
    sortOrder: 1
  },
  {
    titleEn: "Free Assessment Session",
    titleAr: "جلسة تقييم مجانية",
    bodyEn: "Complimentary fitness assessment with a certified female coach for new members.",
    bodyAr: "تقييم لياقة مجاني مع مدربة معتمدة للعضوات الجديدات.",
    imageUrl: "/assets/images/offer-coaching.webp",
    discountValue: 0,
    badgeEn: "New",
    badgeAr: "جديد",
    expiresAt: "2026-11-30 23:59:59",
    sortOrder: 2
  }
];

async function resolveWomenBranchId() {
  const rows = await query("SELECT id FROM branches WHERE code = 'women' LIMIT 1");
  if (!rows[0]) {
    throw new Error("Women's branch (code='women') not found -- run the women-branch migration first.");
  }
  return rows[0].id;
}

async function seedSettings(branchId, settings) {
  for (const [key, value, type, labelEn, labelAr] of settings) {
    await query(
      `INSERT INTO settings (branch_id, key_name, value, type, label_en, label_ar)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), type = VALUES(type), label_en = VALUES(label_en), label_ar = VALUES(label_ar)`,
      [branchId, key, value, type, labelEn, labelAr]
    );
  }
}

async function seedPlans(branchId, plans) {
  for (const plan of plans) {
    const existing = await query(
      `SELECT id FROM plans
       WHERE branch_id = ? AND deleted_at IS NULL AND (name_en = ? OR sort_order = ?)
       ORDER BY name_en = ? DESC, id ASC
       LIMIT 1`,
      [branchId, plan[1], plan[10], plan[1]]
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
        `INSERT INTO plans (branch_id, name_ar, name_en, description_ar, description_en, duration_days, bonus_days, price, original_price, is_active, is_featured, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [branchId, ...plan]
      );
    }
  }
}

async function seedHomepageText(branchId, sections) {
  for (const section of sections) {
    await query(
      `INSERT INTO homepage_text (branch_id, section_key, title_en, title_ar, body_en, body_ar)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE title_en = VALUES(title_en), title_ar = VALUES(title_ar), body_en = VALUES(body_en), body_ar = VALUES(body_ar)`,
      [branchId, section.sectionKey, section.titleEn, section.titleAr, section.bodyEn, section.bodyAr]
    );
  }
}

async function seedSlides(branchId, slides) {
  for (const slide of slides) {
    const existing = await query(
      "SELECT id FROM slider_images WHERE branch_id = ? AND title_en = ? LIMIT 1",
      [branchId, slide.titleEn]
    );
    if (existing[0]) {
      await query(
        `UPDATE slider_images
         SET image_url = ?, fallback_image_url = ?, title_ar = ?, body_en = ?, body_ar = ?, sort_order = ?,
           is_active = 1, updated_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [slide.imageUrl, slide.fallbackImageUrl, slide.titleAr, slide.bodyEn, slide.bodyAr, slide.sortOrder, existing[0].id]
      );
    } else {
      await query(
        `INSERT INTO slider_images (branch_id, image_url, fallback_image_url, title_en, title_ar, body_en, body_ar, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [branchId, slide.imageUrl, slide.fallbackImageUrl, slide.titleEn, slide.titleAr, slide.bodyEn, slide.bodyAr, slide.sortOrder]
      );
    }
  }
}

async function seedOffers(branchId, offers) {
  for (const offer of offers) {
    const existing = await query(
      "SELECT id FROM offers WHERE branch_id = ? AND title_en = ? AND deleted_at IS NULL LIMIT 1",
      [branchId, offer.titleEn]
    );
    if (existing[0]) {
      await query(
        `UPDATE offers
         SET title_ar = ?, body_en = ?, body_ar = ?, image_url = ?, discount_value = ?, badge_en = ?, badge_ar = ?,
           expires_at = ?, sort_order = ?, is_active = 1, updated_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [offer.titleAr, offer.bodyEn, offer.bodyAr, offer.imageUrl, offer.discountValue, offer.badgeEn, offer.badgeAr, offer.expiresAt, offer.sortOrder, existing[0].id]
      );
    } else {
      await query(
        `INSERT INTO offers (branch_id, title_en, title_ar, body_en, body_ar, image_url, discount_value, badge_en, badge_ar, expires_at, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [branchId, offer.titleEn, offer.titleAr, offer.bodyEn, offer.bodyAr, offer.imageUrl, offer.discountValue, offer.badgeEn, offer.badgeAr, offer.expiresAt, offer.sortOrder]
      );
    }
  }
}

async function seed() {
  if (!hasDatabaseConfig()) {
    throw new Error("Set DB_HOST, DB_USER, and DB_NAME or DATABASE_URL before running db:seed.");
  }

  // --- Main Branch (branch_id 1) ---
  await seedSettings(1, mainSettings);
  await seedPlans(1, mainPlans);

  // --- Women's Branch (id resolved by code, never assumed) ---
  const womenBranchId = await resolveWomenBranchId();
  await seedSettings(womenBranchId, womenSettings);
  await seedPlans(womenBranchId, womenPlans);
  await seedHomepageText(womenBranchId, womenHomepageText);
  await seedSlides(womenBranchId, womenSlides);
  await seedOffers(womenBranchId, womenOffers);

  process.stdout.write(`Database seed completed (Main branch_id=1, Women's branch_id=${womenBranchId}).\n`);
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
