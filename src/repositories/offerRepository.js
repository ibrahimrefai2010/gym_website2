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

async function listOffers({ includeInactive = false } = {}) {
  if (!hasDatabaseConfig()) {
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

  const where = includeInactive
    ? "WHERE deleted_at IS NULL"
    : "WHERE expires_at > UTC_TIMESTAMP() AND is_active = 1 AND deleted_at IS NULL";
  const rows = await query(
    `SELECT id, title_en, title_ar, body_en, body_ar, image_url, discount_value,
      badge_en, badge_ar, button_text_en, button_text_ar, button_url, starts_at,
      expires_at, sort_order, is_active
     FROM offers
     ${where}
     ORDER BY sort_order ASC, id DESC`
  );

  return rows.map(mapOffer);
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

  if (payload.id) {
    const result = await query(
      `UPDATE offers
       SET title_en = ?, title_ar = ?, body_en = ?, body_ar = ?, image_url = ?,
         discount_value = ?, badge_en = ?, badge_ar = ?, button_text_en = ?,
         button_text_ar = ?, button_url = ?, starts_at = ?, expires_at = ?,
         sort_order = ?, is_active = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ? AND deleted_at IS NULL`,
      [
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
      (title_en, title_ar, body_en, body_ar, image_url, discount_value, badge_en,
       badge_ar, button_text_en, button_text_ar, button_url, starts_at, expires_at,
       sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
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
  listOffers,
  saveOffer
};
