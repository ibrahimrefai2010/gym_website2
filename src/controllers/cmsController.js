// Content management (Part 2 §2.0.8): branch contact/social/SEO settings,
// FAQs, and drag-and-drop ordering of slides / offers / plans / FAQs.
//
// Branch rules: everything writes to the admin's server-resolved branch.
// Shared FAQs (branch_id NULL, shown on every branch's site) can only be
// created or edited by admins who can switch branches. Reordering only
// touches rows of the current branch (plus shared FAQs/slides for
// cross-branch admins); ids from another branch are rejected.

const { query, transaction } = require("../config/database");
const faqRepository = require("../repositories/faqRepository");
const settingsRepository = require("../repositories/settingsRepository");
const { assertBranchOwnership, canSwitchBranch, resolveWriteBranchId } = require("../security/branchAccess");
const { cleanString } = require("../utils/validator");
const { createHttpError } = require("../utils/httpError");
const { createLog } = require("../utils/logger");

const CONTACT_KEYS = [
  "phone_number", "whatsapp_number", "contact_email", "address_en", "address_ar", "google_maps_url",
  "working_hours_en", "working_hours_ar", "whatsapp_message_en", "whatsapp_message_ar",
  "instagram_url", "x_url", "tiktok_url", "snapchat_url",
  "gym_name_en", "gym_name_ar", "meta_title_en", "meta_title_ar", "meta_description_en", "meta_description_ar", "favicon_url"
];
const URL_KEYS = new Set(["google_maps_url", "instagram_url", "x_url", "tiktok_url", "snapchat_url"]);

function validateContactValue(key, raw) {
  const value = cleanString(raw, key.startsWith("meta_description") || key.startsWith("whatsapp_message") ? 500 : 255);
  if (!value) return "";
  if (URL_KEYS.has(key) && !/^https:\/\/[^\s]+$/i.test(value)) {
    throw createHttpError(422, `${key} must be an https:// link.`, "CMS_URL_INVALID");
  }
  if (key === "favicon_url" && !/^(https:\/\/|\/)[^\s]+$/i.test(value)) {
    throw createHttpError(422, "Favicon must be a site path or https:// link.", "CMS_URL_INVALID");
  }
  if (key === "whatsapp_number" && !/^\d{9,15}$/.test(value.replace(/[^\d]/g, ""))) {
    throw createHttpError(422, "WhatsApp number must be digits in international format, e.g. 9665XXXXXXXX.", "CMS_WHATSAPP_INVALID");
  }
  if (key === "contact_email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw createHttpError(422, "Enter a valid contact email.", "INVALID_EMAIL");
  }
  return key === "whatsapp_number" ? value.replace(/[^\d]/g, "") : value;
}

async function getContact(req, res) {
  const branchId = await resolveWriteBranchId(req);
  const rows = await query(`SELECT key_name, value FROM settings WHERE branch_id = ? AND key_name IN (${CONTACT_KEYS.map(() => "?").join(",")})`, [branchId, ...CONTACT_KEYS]);
  const values = Object.fromEntries(CONTACT_KEYS.map((key) => [key, ""]));
  rows.forEach((row) => {
    values[row.key_name] = row.value ?? "";
  });
  res.json({ success: true, data: { branchId, values } });
}

async function saveContact(req, res) {
  const branchId = await resolveWriteBranchId(req);
  const input = req.body?.values || {};
  const updates = {};
  for (const key of CONTACT_KEYS) {
    if (input[key] !== undefined) updates[key] = validateContactValue(key, input[key]);
  }
  if (!Object.keys(updates).length) throw createHttpError(422, "Nothing to save.", "CMS_EMPTY");
  for (const [key, value] of Object.entries(updates)) {
    await settingsRepository.saveSetting(key, value, req.user.id, "string", branchId);
  }
  await createLog("admin", req.user.id, "cms.contact.update", "settings", null, { keys: Object.keys(updates) }, req.ip, branchId);
  res.json({ success: true, data: { saved: Object.keys(updates) } });
}

// ---- FAQs ----

async function listFaqs(req, res) {
  const branchId = await resolveWriteBranchId(req);
  res.json({ success: true, data: await faqRepository.listFaqs({ branchId, includeInactive: true }) });
}

async function faqTargetBranch(req) {
  const wantsShared = req.body?.shared === true;
  if (wantsShared) {
    if (!(await canSwitchBranch(req.user))) {
      throw createHttpError(403, "Only cross-branch admins can edit FAQs shared by all branches.", "FAQ_SHARED_FORBIDDEN");
    }
    return null;
  }
  return resolveWriteBranchId(req);
}

async function assertFaqWritable(req, faq) {
  if (!faq) throw createHttpError(404, "FAQ not found.", "FAQ_NOT_FOUND");
  if (faq.shared) {
    if (!(await canSwitchBranch(req.user))) throw createHttpError(403, "Only cross-branch admins can edit FAQs shared by all branches.", "FAQ_SHARED_FORBIDDEN");
    return;
  }
  await assertBranchOwnership(faq, req, createHttpError(404, "FAQ not found.", "FAQ_NOT_FOUND"));
}

async function saveFaq(req, res) {
  if (req.body?.id) await assertFaqWritable(req, await faqRepository.getFaq(req.body.id));
  const branchId = await faqTargetBranch(req);
  const data = await faqRepository.saveFaq(req.body || {}, branchId);
  await createLog("admin", req.user.id, req.body?.id ? "faq.update" : "faq.create", "faqs", data.id, { shared: branchId == null }, req.ip, branchId);
  res.status(req.body?.id ? 200 : 201).json({ success: true, data });
}

async function deleteFaq(req, res) {
  const faq = await faqRepository.getFaq(req.params.id);
  await assertFaqWritable(req, faq);
  const data = await faqRepository.deleteFaq(faq.id);
  await createLog("admin", req.user.id, "faq.delete", "faqs", faq.id, null, req.ip, faq.branchId);
  res.json({ success: true, data });
}

// ---- Ordering ----

const ORDERABLE = {
  slides: { table: "slider_images", column: "sort_order", deletedFilter: "" },
  offers: { table: "offers", column: "sort_order", deletedFilter: "AND deleted_at IS NULL" },
  plans: { table: "plans", column: "sort_order", deletedFilter: "AND deleted_at IS NULL" },
  faqs: { table: "faqs", column: "sort_order", deletedFilter: "AND deleted_at IS NULL" }
};

async function reorder(req, res) {
  const config = ORDERABLE[req.params.type];
  if (!config) throw createHttpError(404, "Unknown list.", "ORDER_TYPE_UNKNOWN");
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map((id) => Number.parseInt(id, 10)).filter(Number.isInteger);
  if (!ids.length || ids.length > 500 || new Set(ids).size !== ids.length) throw createHttpError(422, "Send the ids in their new order.", "ORDER_IDS_INVALID");
  const branchId = await resolveWriteBranchId(req);
  const allowShared = ["slides", "faqs"].includes(req.params.type) && (await canSwitchBranch(req.user));
  const rows = await query(`SELECT id, branch_id FROM ${config.table} WHERE id IN (${ids.map(() => "?").join(",")}) ${config.deletedFilter}`, ids);
  const ok = rows.length === ids.length && rows.every((row) => Number(row.branch_id) === Number(branchId) || (row.branch_id == null && allowShared));
  if (!ok) throw createHttpError(404, "One or more items were not found.", "ORDER_ITEM_NOT_FOUND");
  await transaction(async (connection) => {
    for (const [index, id] of ids.entries()) {
      await connection.execute(`UPDATE ${config.table} SET ${config.column} = ? WHERE id = ?`, [(index + 1) * 10, id]);
    }
  });
  await createLog("admin", req.user.id, `${req.params.type}.reorder`, config.table, null, { ids }, req.ip, branchId);
  res.json({ success: true, data: { ids } });
}

module.exports = { CONTACT_KEYS, deleteFaq, getContact, listFaqs, reorder, saveContact, saveFaq };
