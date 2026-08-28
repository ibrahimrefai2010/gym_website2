const { hasDatabaseConfig, query } = require("../config/database");
const fallbackData = require("../db/fallbackData");
const { createHttpError } = require("../utils/httpError");
const { cleanImageReference } = require("../utils/imageReference");
const { cleanString } = require("../utils/validator");

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

function boolValue(value, fallback = true) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return value === true || value === 1 || String(value).toLowerCase() === "true";
}

function fallbackSlides() {
  return fallbackData.slides.map((slide, index) => ({
    ...slide,
    isActive: true,
    sortOrder: index + 1,
    source: "fallback"
  }));
}

function mapSlide(slide) {
  return {
    id: slide.id,
    imageUrl: slide.image_url,
    fallbackImageUrl: slide.fallback_image_url,
    title: { en: slide.title_en, ar: slide.title_ar },
    body: { en: slide.body_en, ar: slide.body_ar },
    sortOrder: slide.sort_order,
    isActive: Boolean(slide.is_active)
  };
}

async function listSlides({ includeInactive = false } = {}) {
  if (!hasDatabaseConfig()) {
    return fallbackSlides();
  }

  const where = includeInactive ? "" : "WHERE is_active = 1";
  let rows = [];
  try {
    rows = await query(
      `SELECT id, image_url, fallback_image_url, title_en, title_ar, body_en, body_ar, sort_order, is_active
       FROM slider_images
       ${where}
       ORDER BY sort_order ASC, id DESC`
    );
  } catch (_error) {
    return fallbackSlides();
  }

  return rows.length > 0 ? rows.map(mapSlide) : fallbackSlides();
}

async function getSlide(id) {
  ensureDatabase();
  const rows = await query(
    `SELECT id, image_url, fallback_image_url, title_en, title_ar, body_en, body_ar, sort_order, is_active
     FROM slider_images
     WHERE id = ?
     LIMIT 1`,
    [id]
  );
  return rows[0] ? mapSlide(rows[0]) : null;
}

async function insertSlide(payload, preferredId = null) {
  const params = [
    cleanImageReference(payload.imageUrl, "Slide image URL", { required: true }),
    cleanImageReference(payload.fallbackImageUrl || payload.imageUrl, "Slide fallback image URL"),
    cleanString(payload.titleEn || payload.title?.en, 160),
    cleanString(payload.titleAr || payload.title?.ar, 160),
    cleanString(payload.bodyEn || payload.body?.en, 4000),
    cleanString(payload.bodyAr || payload.body?.ar, 4000),
    Number(payload.sortOrder || payload.displayOrder || 0),
    boolValue(payload.isActive)
  ];

  if (!params[2] || !params[3] || !params[4] || !params[5]) {
    throw createHttpError(422, "Slide title and body are required in both languages.", "SLIDE_FIELDS_REQUIRED");
  }

  const result = preferredId
    ? await query(
        `INSERT INTO slider_images
          (id, image_url, fallback_image_url, title_en, title_ar, body_en, body_ar, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [preferredId, ...params]
      )
    : await query(
        `INSERT INTO slider_images
          (image_url, fallback_image_url, title_en, title_ar, body_en, body_ar, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params
      );

  return getSlide(preferredId || result.insertId);
}

async function saveSlide(payload) {
  ensureDatabase();
  const imageUrl = cleanImageReference(payload.imageUrl, "Slide image URL", { required: true });
  const fallbackImageUrl = cleanImageReference(payload.fallbackImageUrl || payload.imageUrl, "Slide fallback image URL");
  const titleEn = cleanString(payload.titleEn || payload.title?.en, 160);
  const titleAr = cleanString(payload.titleAr || payload.title?.ar, 160);
  const bodyEn = cleanString(payload.bodyEn || payload.body?.en, 4000);
  const bodyAr = cleanString(payload.bodyAr || payload.body?.ar, 4000);

  if (!titleEn || !titleAr || !bodyEn || !bodyAr) {
    throw createHttpError(422, "Slide title and body are required in both languages.", "SLIDE_FIELDS_REQUIRED");
  }

  if (payload.id) {
    const result = await query(
      `UPDATE slider_images
       SET image_url = ?, fallback_image_url = ?, title_en = ?, title_ar = ?, body_en = ?,
         body_ar = ?, sort_order = ?, is_active = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        imageUrl,
        fallbackImageUrl,
        titleEn,
        titleAr,
        bodyEn,
        bodyAr,
        Number(payload.sortOrder || payload.displayOrder || 0),
        boolValue(payload.isActive),
        payload.id
      ]
    );

    if (result.affectedRows > 0) {
      return getSlide(payload.id);
    }

    return insertSlide(
      { ...payload, imageUrl, fallbackImageUrl, titleEn, titleAr, bodyEn, bodyAr },
      Number.isInteger(Number(payload.id)) && Number(payload.id) > 0 ? Number(payload.id) : null
    );
  }

  return insertSlide({ ...payload, imageUrl, fallbackImageUrl, titleEn, titleAr, bodyEn, bodyAr });
}

module.exports = {
  listSlides,
  saveSlide
};
