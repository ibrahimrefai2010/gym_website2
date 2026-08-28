const { createHttpError } = require("./httpError");

function cleanString(value, maxLength = 500) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value)
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanEmail(value) {
  return cleanString(value, 190).toLowerCase();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(value));
}

function assertEmail(value) {
  if (!isEmail(value)) {
    throw createHttpError(422, "Enter a valid email address.", "INVALID_EMAIL");
  }
}

function cleanPhone(value) {
  return cleanString(value, 40).replace(/[^\d+]/g, "");
}

function normalizeSaudiPhone(value) {
  return cleanString(value, 40).replace(/[^\d]/g, "");
}

function isSaudiPhone(value) {
  return /^(05|5)(5|0|3|6|4|9|1|8|7)([0-9]{7})$/.test(normalizeSaudiPhone(value));
}

function assertSaudiPhone(value) {
  if (!isSaudiPhone(value)) {
    throw createHttpError(422, "Enter a valid Saudi mobile number.", "INVALID_PHONE");
  }
}

function assertStrongPassword(password) {
  const value = String(password || "");
  if (value.length < 8 || !/[A-Z]/.test(value) || !/[0-9]/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    throw createHttpError(
      422,
      "Password must be at least 8 characters and include one uppercase letter, one number, and one special character.",
      "WEAK_PASSWORD"
    );
  }
}

function assertMaxLength(value, maxLength, label = "Value") {
  if (String(value || "").length > maxLength) {
    throw createHttpError(422, `${label} must be ${maxLength} characters or fewer.`, "MAX_LENGTH_EXCEEDED");
  }
}

function assertEnum(value, allowed, label = "Value") {
  if (!allowed.includes(value)) {
    throw createHttpError(422, `${label} is invalid.`, "INVALID_ENUM_VALUE");
  }
}

function assertPositiveNumber(value, label = "Value", { allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) {
    throw createHttpError(422, `${label} must be a valid ${allowZero ? "non-negative" : "positive"} number.`, "INVALID_NUMBER");
  }
  return number;
}

function positiveInteger(value, fallback = 1, max = 100) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number < 1) {
    return fallback;
  }
  return Math.min(number, max);
}

function requireFields(payload, fields) {
  const missing = fields.filter((field) => !cleanString(payload[field]));
  if (missing.length > 0) {
    throw createHttpError(400, `Missing required fields: ${missing.join(", ")}`, "VALIDATION_ERROR");
  }
}

function pagination(query) {
  const page = positiveInteger(query.page, 1, 1000000);
  const pageSize = positiveInteger(query.pageSize, 10, 100);
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize
  };
}

module.exports = {
  assertEmail,
  assertEnum,
  assertMaxLength,
  assertPositiveNumber,
  assertSaudiPhone,
  assertStrongPassword,
  cleanEmail,
  cleanPhone,
  cleanString,
  isSaudiPhone,
  normalizeSaudiPhone,
  pagination,
  positiveInteger,
  requireFields
};
