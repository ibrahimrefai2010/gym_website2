const { hasDatabaseConfig, query } = require("../config/database");
const { createHttpError } = require("../utils/httpError");

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

const FIELDS = [
  "legal_entity_name_ar",
  "legal_entity_name_en",
  "vat_number",
  "cr_number",
  "owner_id_number",
  "vat_rate",
  "vat_effective_date",
  "municipality_ar",
  "municipality_en",
  "district_ar",
  "district_en",
  "street_ar",
  "street_en",
  "building_number",
  "postal_code",
  "city_ar",
  "city_en",
  "country_code"
];

const CAMEL = (snake) => snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

function toCamel(row) {
  if (!row) return null;
  const out = {};
  for (const field of FIELDS) {
    out[CAMEL(field)] = row[field];
  }
  out.vatRate = row.vat_rate == null ? null : Number(row.vat_rate);
  out.vatEffectiveDate = row.vat_effective_date
    ? String(row.vat_effective_date).slice(0, 10)
    : null;
  out.updatedAt = row.updated_at;
  return out;
}

// Two branches, two separate VAT registrations -> one business_settings row
// per branch (branch_id UNIQUE). branchId defaults to 1 (Main) so pre-branch
// callers keep working unchanged.
async function get(branchId = 1) {
  ensureDatabase();
  const rows = await query("SELECT * FROM business_settings WHERE branch_id = ? LIMIT 1", [branchId || 1]);
  return toCamel(rows[0] || null);
}

async function update(payload = {}, adminId = null, branchId = 1) {
  ensureDatabase();
  const set = [];
  const params = [];
  for (const field of FIELDS) {
    const key = CAMEL(field);
    if (payload[key] === undefined) continue;
    let value = payload[key];
    if (field === "vat_rate") {
      value = Number(value);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw createHttpError(422, "VAT rate must be between 0 and 100.", "VAT_RATE_INVALID");
      }
    }
    if (field === "vat_number" && value && !/^\d{15}$/.test(String(value))) {
      throw createHttpError(422, "VAT number must be 15 digits.", "VAT_NUMBER_INVALID");
    }
    if (field === "vat_effective_date" && value === "") {
      value = null;
    }
    set.push(`${field} = ?`);
    params.push(value === undefined ? null : value);
  }

  if (set.length === 0) {
    return get(branchId);
  }

  set.push("updated_by = ?");
  params.push(adminId);
  params.push(branchId || 1);
  await query(`UPDATE business_settings SET ${set.join(", ")} WHERE branch_id = ?`, params);
  return get(branchId);
}

module.exports = { get, update };
