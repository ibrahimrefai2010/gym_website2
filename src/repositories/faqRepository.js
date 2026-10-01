// FAQs (Part 2 §2.0.8). branch_id NULL = shared by every branch's site;
// a branch id = that branch only. See migration 202610010006_cms.

const { hasDatabaseConfig, query } = require("../config/database");
const { createHttpError } = require("../utils/httpError");
const { cleanString } = require("../utils/validator");

function mapFaq(row) {
  return {
    id: row.id,
    branchId: row.branch_id == null ? null : Number(row.branch_id),
    shared: row.branch_id == null,
    question: { en: row.question_en, ar: row.question_ar },
    answer: { en: row.answer_en, ar: row.answer_ar },
    sortOrder: Number(row.sort_order || 0),
    isActive: Boolean(row.is_active)
  };
}

// Public + admin list for one branch: its own FAQs plus the shared ones.
async function listFaqs({ branchId, includeInactive = false } = {}) {
  if (!hasDatabaseConfig()) return [];
  const where = ["deleted_at IS NULL", "(branch_id = ? OR branch_id IS NULL)"];
  if (!includeInactive) where.push("is_active = 1");
  const rows = await query(
    `SELECT id, branch_id, question_en, question_ar, answer_en, answer_ar, sort_order, is_active
     FROM faqs WHERE ${where.join(" AND ")} ORDER BY sort_order ASC, id ASC`,
    [branchId || 0]
  );
  return rows.map(mapFaq);
}

async function getFaq(id) {
  const rows = await query("SELECT * FROM faqs WHERE id = ? AND deleted_at IS NULL LIMIT 1", [id]);
  return rows[0] ? mapFaq(rows[0]) : null;
}

function validate(payload) {
  const fields = {
    question_en: cleanString(payload.questionEn, 255),
    question_ar: cleanString(payload.questionAr, 255),
    answer_en: cleanString(payload.answerEn, 4000),
    answer_ar: cleanString(payload.answerAr, 4000)
  };
  if (Object.values(fields).some((value) => !value)) {
    throw createHttpError(422, "Question and answer are required in both languages.", "FAQ_FIELDS_REQUIRED");
  }
  return fields;
}

async function saveFaq(payload, branchId) {
  const fields = validate(payload);
  const sortOrder = Number.parseInt(payload.sortOrder, 10) || 0;
  const isActive = payload.isActive !== false;
  if (payload.id) {
    await query(
      `UPDATE faqs SET branch_id = ?, question_en = ?, question_ar = ?, answer_en = ?, answer_ar = ?, sort_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND deleted_at IS NULL`,
      [branchId, fields.question_en, fields.question_ar, fields.answer_en, fields.answer_ar, sortOrder, isActive, payload.id]
    );
    return getFaq(payload.id);
  }
  const result = await query(
    "INSERT INTO faqs (branch_id, question_en, question_ar, answer_en, answer_ar, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [branchId, fields.question_en, fields.question_ar, fields.answer_en, fields.answer_ar, sortOrder, isActive]
  );
  return getFaq(result.insertId);
}

async function deleteFaq(id) {
  await query("UPDATE faqs SET deleted_at = CURRENT_TIMESTAMP, is_active = 0 WHERE id = ?", [id]);
  return { id: Number(id), deleted: true };
}

module.exports = { deleteFaq, getFaq, listFaqs, saveFaq };
