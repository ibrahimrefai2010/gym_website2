const { hasDatabaseConfig, query } = require("../config/database");
const fallbackData = require("../db/fallbackData");
const { createHttpError } = require("../utils/httpError");
const { assertPositiveNumber, cleanString } = require("../utils/validator");

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

// features JSON: {"en": [...], "ar": [...]} (migration 202609090001).
function parseFeatures(value) {
  let data = value;
  if (typeof value === "string") {
    try {
      data = JSON.parse(value);
    } catch (_error) {
      data = null;
    }
  }
  const list = (items) => (Array.isArray(items) ? items.map((item) => String(item).trim()).filter(Boolean).slice(0, 20) : []);
  return { en: list(data?.en), ar: list(data?.ar) };
}

function featuresJson(payload) {
  const split = (value) => (Array.isArray(value) ? value : String(value || "").split(/\r?\n/)).map((item) => cleanString(item, 160)).filter(Boolean).slice(0, 20);
  return JSON.stringify({ en: split(payload.featuresEn ?? payload.features?.en), ar: split(payload.featuresAr ?? payload.features?.ar) });
}

function mapPlan(plan) {
  const price = Number(plan.price || 0);
  const original = Number(plan.original_price || price);
  return {
    id: plan.id,
    branchId: plan.branch_id != null ? Number(plan.branch_id) : null,
    name: { en: plan.name_en, ar: plan.name_ar },
    description: { en: plan.description_en, ar: plan.description_ar },
    durationDays: Number(plan.duration_days || 0),
    priceOriginal: original,
    priceDiscounted: price,
    price,
    originalPrice: original,
    bonusDays: Number(plan.bonus_days || 0),
    currency: "SAR",
    billingPeriod: { en: `${plan.duration_days} days`, ar: `${plan.duration_days} يوم` },
    highlighted: Boolean(plan.is_featured),
    isFeatured: Boolean(plan.is_featured),
    displayOrder: plan.sort_order,
    sortOrder: plan.sort_order,
    isActive: Boolean(plan.is_active),
    features: parseFeatures(plan.features)
  };
}

async function listPlans({ includeInactive = false, branchId = "" } = {}) {
  if (!hasDatabaseConfig()) {
    // Fallback demo data is the Main branch's baseline only (see fallbackData.js).
    return includeInactive ? fallbackData.plans : fallbackData.plans.filter((plan) => plan.isActive !== false);
  }

  const where = [includeInactive ? "deleted_at IS NULL" : "is_active = 1 AND deleted_at IS NULL"];
  const params = [];
  if (branchId) {
    where.push("branch_id = ?");
    params.push(branchId);
  }
  const rows = await query(
    `SELECT id, branch_id, name_en, name_ar, description_en, description_ar, duration_days,
      bonus_days, price, original_price, is_active, is_featured, sort_order, features
     FROM plans
     WHERE ${where.join(" AND ")}
     ORDER BY sort_order ASC, id DESC`,
    params
  );

  return rows.map(mapPlan);
}

async function getPlan(id) {
  const plans = await listPlans({ includeInactive: true });
  return plans.find((plan) => String(plan.id) === String(id)) || null;
}

async function savePlan(payload) {
  ensureDatabase();
  const nameEn = cleanString(payload.nameEn, 120);
  const nameAr = cleanString(payload.nameAr, 120);
  const descriptionEn = cleanString(payload.descriptionEn, 2000);
  const descriptionAr = cleanString(payload.descriptionAr, 2000);
  if (!nameEn || !nameAr || !descriptionEn || !descriptionAr) {
    throw createHttpError(422, "Plan name and description are required in both languages.", "PLAN_FIELDS_REQUIRED");
  }

  const durationDays = assertPositiveNumber(payload.durationDays || payload.duration_days || 30, "Plan duration");
  const bonusDays = assertPositiveNumber(payload.bonusDays || payload.bonus_days || 0, "Plan bonus days", { allowZero: true });
  const price = assertPositiveNumber(payload.priceDiscounted || payload.price, "Plan price");
  const originalPrice = assertPositiveNumber(payload.originalPrice || payload.priceOriginal || price, "Original plan price");
  // Every plan belongs to exactly one branch (no NULL-branch "both" tier) --
  // a promo meant for both branches is two separate plan rows.
  const branchId = Number(payload.branchId);
  if (!Number.isInteger(branchId) || branchId < 1) {
    throw createHttpError(422, "Plan branchId is required.", "PLAN_BRANCH_REQUIRED");
  }

  if (payload.id) {
    await query(
      `UPDATE plans
       SET branch_id = ?, name_en = ?, name_ar = ?, description_en = ?, description_ar = ?,
         duration_days = ?, bonus_days = ?, price = ?, original_price = ?,
         is_active = ?, is_featured = ?, sort_order = ?, features = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ? AND deleted_at IS NULL`,
      [
        branchId,
        nameEn,
        nameAr,
        descriptionEn,
        descriptionAr,
        durationDays,
        bonusDays,
        price,
        originalPrice,
        payload.isActive !== false,
        Boolean(payload.isFeatured || payload.highlighted),
        Number(payload.displayOrder || payload.sortOrder || 0),
        featuresJson(payload),
        payload.id
      ]
    );
    const plan = await getPlan(payload.id);
    if (!plan) {
      throw createHttpError(404, "Plan not found.", "PLAN_NOT_FOUND");
    }
    return plan;
  }

  const result = await query(
    `INSERT INTO plans
      (branch_id, name_en, name_ar, description_en, description_ar, duration_days, bonus_days,
       price, original_price, is_active, is_featured, sort_order, features)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      branchId,
      nameEn,
      nameAr,
      descriptionEn,
      descriptionAr,
      durationDays,
      bonusDays,
      price,
      originalPrice,
      payload.isActive !== false,
      Boolean(payload.isFeatured || payload.highlighted),
      Number(payload.displayOrder || payload.sortOrder || 0),
      featuresJson(payload)
    ]
  );

  return getPlan(result.insertId);
}

// A plan with active or pending memberships cannot be deleted -- deactivate
// it instead (hidden from sale, existing members unaffected).
async function deletePlan(id) {
  ensureDatabase();
  const [inUse] = await query(
    "SELECT COUNT(*) AS n FROM memberships WHERE plan_id = ? AND status IN ('active','pending')",
    [id]
  );
  if (Number(inUse.n) > 0) {
    throw createHttpError(
      409,
      `This plan has ${inUse.n} active or pending membership(s). Deactivate it instead of deleting.`,
      "PLAN_IN_USE"
    );
  }
  const result = await query(
    "UPDATE plans SET is_active = 0, deleted_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ? AND deleted_at IS NULL",
    [id]
  );
  if (result.affectedRows === 0) {
    throw createHttpError(404, "Plan not found.", "PLAN_NOT_FOUND");
  }
  return { id, deleted: true };
}

module.exports = {
  deletePlan,
  getPlan,
  listPlans,
  savePlan
};
