const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { env } = require("../config/env");

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

async function hashPassword(password) {
  return bcrypt.hash(password, env.bcryptRounds);
}

async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

module.exports = {
  hashPassword,
  tokenHash,
  verifyPassword
};
