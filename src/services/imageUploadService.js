const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { createHttpError } = require("../utils/httpError");

const maxImageBytes = 4 * 1024 * 1024;
const publicDir = path.join(__dirname, "..", "..", "public");
const uploadDir = path.join(publicDir, "uploads", "images");

const allowedTypes = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

function slugName(value) {
  const slug = String(value || "image")
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "image";
}

function hasExpectedSignature(buffer, mimeType) {
  if (mimeType === "image/png") {
    return buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/jpeg") {
    return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === "image/webp") {
    return buffer.length > 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  }
  if (mimeType === "image/gif") {
    const header = buffer.toString("ascii", 0, 6);
    return header === "GIF87a" || header === "GIF89a";
  }
  return false;
}

async function saveImageUpload(payload = {}) {
  const match = String(payload.dataUrl || "").match(/^data:(image\/(?:gif|jpe?g|png|webp));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) {
    throw createHttpError(422, "Upload must be a PNG, JPG, WebP, or GIF image.", "IMAGE_UPLOAD_INVALID");
  }

  const mimeType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const extension = allowedTypes[mimeType];
  if (!extension) {
    throw createHttpError(422, "This image type is not supported.", "IMAGE_TYPE_UNSUPPORTED");
  }

  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (buffer.length === 0) {
    throw createHttpError(422, "Uploaded image is empty.", "IMAGE_UPLOAD_EMPTY");
  }
  if (buffer.length > maxImageBytes) {
    throw createHttpError(413, "Uploaded image must be 4MB or smaller.", "IMAGE_UPLOAD_TOO_LARGE");
  }
  if (!hasExpectedSignature(buffer, mimeType)) {
    throw createHttpError(422, "Uploaded file content does not match the image type.", "IMAGE_SIGNATURE_INVALID");
  }

  await fs.mkdir(uploadDir, { recursive: true });
  const stem = slugName(payload.fileName);
  const fileName = `${Date.now()}-${stem}-${crypto.randomBytes(6).toString("hex")}.${extension}`;
  const absolutePath = path.join(uploadDir, fileName);
  await fs.writeFile(absolutePath, buffer, { flag: "wx" });

  return {
    contentType: mimeType,
    fileName,
    size: buffer.length,
    url: `/uploads/images/${fileName}`
  };
}

module.exports = {
  saveImageUpload
};
