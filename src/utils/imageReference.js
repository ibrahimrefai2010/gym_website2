const { createHttpError } = require("./httpError");
const { cleanString } = require("./validator");

function cleanImageReference(value, fieldName = "Image URL", { required = false } = {}) {
  const cleaned = cleanString(value || "", 255);
  if (!cleaned) {
    if (required) {
      throw createHttpError(422, `${fieldName} is required.`, "IMAGE_URL_REQUIRED");
    }
    return "";
  }

  if (!/^(\/(?!\/)|https?:\/\/)/i.test(cleaned)) {
    throw createHttpError(422, `${fieldName} must be a site path or http(s) URL.`, "IMAGE_URL_INVALID");
  }

  return cleaned;
}

module.exports = {
  cleanImageReference
};
