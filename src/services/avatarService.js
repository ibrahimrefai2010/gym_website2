const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { createHttpError } = require("../utils/httpError");

const MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_DIR = path.join(__dirname, "..", "..", "storage", "avatars");

const ALLOWED = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

function hasSignature(buffer, mimeType) {
  if (mimeType === "image/png") {
    return (
      buffer.length > 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }
  if (mimeType === "image/jpeg") {
    return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === "image/webp") {
    return (
      buffer.length > 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    );
  }
  return false;
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:jpe?g|png|webp));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) {
    throw createHttpError(422, "Upload a JPEG, PNG, or WebP image.", "AVATAR_INVALID");
  }
  const mimeType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  return { mimeType, buffer };
}

function avatarFilePath(storedName) {
  if (!storedName || storedName.includes("/") || storedName.includes("\\") || storedName.includes("..")) {
    return null;
  }
  return path.join(AVATAR_DIR, storedName);
}

async function saveAvatar(userId, dataUrl, previousStoredName) {
  const { mimeType, buffer } = parseDataUrl(dataUrl);
  const extension = ALLOWED[mimeType];
  if (!extension) {
    throw createHttpError(422, "This image type is not supported.", "AVATAR_TYPE_UNSUPPORTED");
  }
  if (buffer.length === 0) {
    throw createHttpError(422, "The image is empty.", "AVATAR_EMPTY");
  }
  if (buffer.length > MAX_BYTES) {
    throw createHttpError(413, "The image must be 2MB or smaller.", "AVATAR_TOO_LARGE");
  }
  if (!hasSignature(buffer, mimeType)) {
    throw createHttpError(422, "The file content does not match an image.", "AVATAR_SIGNATURE_INVALID");
  }

  await fs.mkdir(AVATAR_DIR, { recursive: true });
  const storedName = `u${Number(userId)}-${crypto.randomBytes(8).toString("hex")}.${extension}`;
  await fs.writeFile(path.join(AVATAR_DIR, storedName), buffer, { flag: "wx" });

  if (previousStoredName) {
    await removeAvatarFile(previousStoredName);
  }

  return { storedName, mimeType, size: buffer.length };
}

async function readAvatar(storedName) {
  const filePath = avatarFilePath(storedName);
  if (!filePath) {
    return null;
  }
  try {
    const buffer = await fs.readFile(filePath);
    const extension = path.extname(filePath).slice(1).toLowerCase();
    const mimeType =
      extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
    return { buffer, mimeType };
  } catch (_error) {
    return null;
  }
}

async function removeAvatarFile(storedName) {
  const filePath = avatarFilePath(storedName);
  if (!filePath) {
    return;
  }
  try {
    await fs.unlink(filePath);
  } catch (_error) {
    /* already gone */
  }
}

module.exports = {
  readAvatar,
  removeAvatarFile,
  saveAvatar
};
