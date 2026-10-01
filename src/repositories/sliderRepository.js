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

// "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" from a date/datetime input -> SQL
// DATETIME (stored as given, Riyadh-local intent is fine at day precision);
// empty -> NULL (no limit).
function scheduleValue(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
  if (!match) {
    throw createHttpError(422, "Schedule dates must be YYYY-MM-DD.", "SLIDE_SCHEDULE_INVALID");
  }
  return `${match[1]} ${match[2] || "00:00"}:00`;
}

function mapSlide(slide) {
  return {
    id: slide.id,
    imageUrl: slide.image_url,
    fallbackImageUrl: slide.fallback_image_url,
    title: { en: slide.title_en, ar: slide.title_ar },
    body: { en: slide.body_en, ar: slide.body_ar },
    sortOrder: slide.sort_order,
    isActive: Boolean(slide.is_active),
    branchId: slide.branch_id == null ? null : Number(slide.branch_id),
    shared: slide.branch_id == null,
    startsAt: slide.starts_at || null,
    endsAt: slide.ends_at || null
  };
}

async function listSlides({ includeInactive = false, branchId = "" } = {}) {
  if (!hasDatabaseConfig()) {
    return fallbackSlides();
  }

  const where = [];
  if (!includeInactive) {
    // Public site: active and inside its schedule window (if any).
    where.push("is_active = 1");
    where.push("(starts_at IS NULL OR starts_at <= UTC_TIMESTAMP())");
    where.push("(ends_at IS NULL OR ends_at > UTC_TIMESTAMP())");
  }
  // branch_id is nullable: NULL rows apply to every branch (today's rows, all
  // still unscoped). A future branch-specific row (branch_id = ?) is included
  // alongside them -- actual per-branch slides are a later seeding phase.
  const params = [];
  if (branchId) {
    where.push("(branch_id = ? OR branch_id IS NULL)");
    params.push(branchId);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  let rows = [];
  try {
    rows = await query(
      `SELECT id, branch_id, image_url, fallback_image_url, title_en, title_ar, body_en, body_ar, sort_order, is_active, starts_at, ends_at
       FROM slider_images
       ${whereSql}
       ORDER BY sort_order ASC, id DESC`,
      params
    );
  } catch (_error) {
    return fallbackSlides();
  }

  return rows.length > 0 ? rows.map(mapSlide) : fallbackSlides();
}

async function getSlide(id) {
  ensureDatabase();
  const rows = await query(
    `SELECT id, branch_id, image_url, fallback_image_url, title_en, title_ar, body_en, body_ar, sort_order, is_active, starts_at, ends_at
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
    boolValue(payload.isActive),
    payload.branchId ?? null,
    scheduleValue(payload.startsAt),
    scheduleValue(payload.endsAt)
  ];

  if (!params[2] || !params[3] || !params[4] || !params[5]) {
    throw createHttpError(422, "Slide title and body are required in both languages.", "SLIDE_FIELDS_REQUIRED");
  }

  const result = preferredId
    ? await query(
        `INSERT INTO slider_images
          (id, image_url, fallback_image_url, title_en, title_ar, body_en, body_ar, sort_order, is_active, branch_id, starts_at, ends_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [preferredId, ...params]
      )
    : await query(
        `INSERT INTO slider_images
          (image_url, fallback_image_url, title_en, title_ar, body_en, body_ar, sort_order, is_active, branch_id, starts_at, ends_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
         body_ar = ?, sort_order = ?, is_active = ?, branch_id = ?, starts_at = ?, ends_at = ?, updated_at = UTC_TIMESTAMP()
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
        payload.branchId ?? null,
        scheduleValue(payload.startsAt),
        scheduleValue(payload.endsAt),
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
  getSlide,
  listSlides,
  saveSlide
};
