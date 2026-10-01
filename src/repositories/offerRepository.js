const { hasDatabaseConfig, query } = require("../config/database");
const fallbackData = require("../db/fallbackData");
const { createHttpError } = require("../utils/httpError");
const { cleanImageReference } = require("../utils/imageReference");
const { assertPositiveNumber, cleanString } = require("../utils/validator");

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

function isCurrent(offer) {
  const now = new Date();
  const expires = offer.endDate || offer.validUntil || offer.expiresAt;
  return offer.isActive !== false && (!expires || new Date(expires) > now);
}

function mapOffer(offer) {
  return {
    id: offer.id,
    branchId: offer.branch_id != null ? Number(offer.branch_id) : null,
    title: { en: offer.title_en, ar: offer.title_ar },
    body: { en: offer.body_en, ar: offer.body_ar },
    description: { en: offer.body_en, ar: offer.body_ar },
    imageUrl: offer.image_url,
    discountValue: Number(offer.discount_value || 0),
    badge: { en: offer.badge_en || "", ar: offer.badge_ar || "" },
    buttonText: { en: offer.button_text_en || "View plans", ar: offer.button_text_ar || "عرض الباقات" },
    buttonUrl: offer.button_url || "#memberships",
    startsAt: offer.starts_at,
    expiresAt: offer.expires_at,
    endDate: offer.expires_at,
    validUntil: offer.expires_at,
    sortOrder: offer.sort_order,
    priority: offer.sort_order,
    isActive: Boolean(offer.is_active)
  };
}

async function listOffers({ includeInactive = false, branchId = "" } = {}) {
  if (!hasDatabaseConfig()) {
    // Fallback demo data is the Main branch's baseline only (see fallbackData.js).
    const offers = fallbackData.offers.map((offer, index) => ({
      ...offer,
      description: offer.body,
      imageUrl: offer.imageUrl || "",
      buttonText: { en: "View plans", ar: "عرض الباقات" },
      buttonUrl: "#memberships",
      priority: index + 1,
      startDate: null,
      endDate: offer.validUntil,
      isActive: true
    }));
    return includeInactive ? offers : offers.filter(isCurrent);
  }

  const where = [includeInactive ? "deleted_at IS NULL" : "expires_at > UTC_TIMESTAMP() AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP()) AND is_active = 1 AND deleted_at IS NULL"];
  const params = [];
  if (branchId) {
    where.push("branch_id = ?");
    params.push(branchId);
  }
  const rows = await query(
    `SELECT id, branch_id, title_en, title_ar, body_en, body_ar, image_url, discount_value,
      badge_en, badge_ar, button_text_en, button_text_ar, button_url, starts_at,
      expires_at, sort_order, is_active
     FROM offers
     WHERE ${where.join(" AND ")}
     ORDER BY sort_order ASC, id DESC`,
    params
  );

  return rows.map(mapOffer);
}

// For by-id ownership checks (offerController.update/remove) -- mirrors
// planRepository.getPlan.
async function getOffer(id) {
  const offers = await listOffers({ includeInactive: true });
  return offers.find((offer) => String(offer.id) === String(id)) || null;
}

async function saveOffer(payload) {
  ensureDatabase();
  const expiresAt = payload.expiresAt || payload.endDate || payload.validUntil;
  if (!expiresAt) {
    throw createHttpError(422, "Offer expiry date is required.", "OFFER_EXPIRY_REQUIRED");
  }
  const titleEn = cleanString(payload.titleEn, 160);
  const titleAr = cleanString(payload.titleAr, 160);
  const bodyEn = cleanString(payload.bodyEn || payload.descriptionEn, 4000);
  const bodyAr = cleanString(payload.bodyAr || payload.descriptionAr, 4000);
  if (!titleEn || !titleAr || !bodyEn || !bodyAr) {
    throw createHttpError(422, "Offer title and body are required in both languages.", "OFFER_FIELDS_REQUIRED");
  }
  const discountValue = assertPositiveNumber(payload.discountValue || 0, "Offer discount", { allowZero: true });
  const imageUrl = cleanImageReference(payload.imageUrl || "", "Offer image URL");
  // Every offer belongs to exactly one branch -- a promo meant for both
  // branches is two separate offer rows (decision 3, same rule as plans).
  const branchId = Number(payload.branchId);
  if (!Number.isInteger(branchId) || branchId < 1) {
    throw createHttpError(422, "Offer branchId is required.", "OFFER_BRANCH_REQUIRED");
  }

  if (payload.id) {
    const result = await query(
      `UPDATE offers
       SET branch_id = ?, title_en = ?, title_ar = ?, body_en = ?, body_ar = ?, image_url = ?,
         discount_value = ?, badge_en = ?, badge_ar = ?, button_text_en = ?,
         button_text_ar = ?, button_url = ?, starts_at = ?, expires_at = ?,
         sort_order = ?, is_active = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ? AND deleted_at IS NULL`,
      [
        branchId,
        titleEn,
        titleAr,
        bodyEn,
        bodyAr,
        imageUrl || null,
        discountValue,
        payload.badgeEn || "",
        payload.badgeAr || "",
        payload.buttonTextEn || "View plans",
        payload.buttonTextAr || "عرض الباقات",
        payload.buttonUrl || "#memberships",
        payload.startsAt || payload.startDate || null,
        expiresAt,
        Number(payload.sortOrder || payload.priority || 0),
        payload.isActive !== false,
        payload.id
      ]
    );
    if (result.affectedRows === 0) {
      throw createHttpError(404, "Offer not found.", "OFFER_NOT_FOUND");
    }
    return { id: payload.id };
  }

  const result = await query(
    `INSERT INTO offers
      (branch_id, title_en, title_ar, body_en, body_ar, image_url, discount_value, badge_en,
       badge_ar, button_text_en, button_text_ar, button_url, starts_at, expires_at,
       sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      branchId,
      titleEn,
      titleAr,
      bodyEn,
      bodyAr,
      imageUrl || null,
      discountValue,
      payload.badgeEn || "",
      payload.badgeAr || "",
      payload.buttonTextEn || "View plans",
      payload.buttonTextAr || "عرض الباقات",
      payload.buttonUrl || "#memberships",
      payload.startsAt || payload.startDate || null,
      expiresAt,
      Number(payload.sortOrder || payload.priority || 0),
      payload.isActive !== false
    ]
  );
  return { id: result.insertId };
}

async function deleteOffer(id) {
  ensureDatabase();
  const result = await query(
    "UPDATE offers SET is_active = 0, deleted_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ? AND deleted_at IS NULL",
    [id]
  );
  if (result.affectedRows === 0) {
    throw createHttpError(404, "Offer not found.", "OFFER_NOT_FOUND");
  }
  return { id, deleted: true };
}

module.exports = {
  deleteOffer,
  getOffer,
  listOffers,
  saveOffer
};
