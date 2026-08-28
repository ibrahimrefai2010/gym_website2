const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const required = [
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "DB_HOST",
  "DB_NAME",
  "DB_USER",
  "CORS_ORIGIN",
  "BASE_URL",
  "ADMIN_REGISTRATION_SECRET"
];
const recommended = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
const missingRequired = required.filter((key) => !process.env[key]);
const missingRecommended = recommended.filter((key) => !process.env[key]);

if (missingRequired.length > 0) {
  console.error(`Missing required production variables: ${missingRequired.join(", ")}`);
  process.exitCode = 1;
}

if (missingRecommended.length > 0) {
  console.warn(`Recommended variables not set: ${missingRecommended.join(", ")}`);
}

const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, "utf8");
  if (/change-me|development-only|development-refresh|yourdomain\.com/.test(envFile)) {
    console.error(".env contains development placeholder secrets.");
    process.exitCode = 1;
  }
}

if (!process.exitCode) {
  console.log("Production configuration check passed.");
}
