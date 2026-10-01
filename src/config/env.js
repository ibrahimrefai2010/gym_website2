const dotenv = require("dotenv");

dotenv.config();

function intEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
}

function boolEnv(key, fallback = false) {
  if (process.env[key] === undefined) {
    return fallback;
  }
  return String(process.env[key]).toLowerCase() === "true";
}

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  appName: "Muscle and Fitness Center",
  port: intEnv("PORT", intEnv("SERVER_PORT", 3000)),
  baseUrl:
    process.env.BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    "http://localhost:3000",
  corsOrigin:
    process.env.CORS_ORIGIN ||
    process.env.RENDER_EXTERNAL_URL ||
    "http://localhost:3000",
  demoMode: boolEnv("DEMO_MODE", false),

  databaseUrl: process.env.DATABASE_URL || "",
  dbHost: process.env.DB_HOST || "",
  dbPort: intEnv("DB_PORT", 3306),
  dbUser: process.env.DB_USER || "",
  dbPassword: process.env.DB_PASSWORD || "",
  dbName: process.env.DB_NAME || "",

  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || "development-access-secret-change-me",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "development-refresh-secret-change-me",
  jwtAccessExpiry: process.env.JWT_ACCESS_EXPIRY || "15m",
  jwtRefreshExpiry: process.env.JWT_REFRESH_EXPIRY || "7d",
  bcryptRounds: intEnv("BCRYPT_ROUNDS", 12),
  adminIdleTimeoutMinutes: intEnv("ADMIN_IDLE_TIMEOUT_MINUTES", 480),

  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: intEnv("SMTP_PORT", 587),
  smtpSecure: boolEnv("SMTP_SECURE", false),
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  emailFrom:
    process.env.EMAIL_FROM || '"Muscle and Fitness Center" <noreply@localhost>',
  otpExpiryMinutes: intEnv("OTP_EXPIRY_MINUTES", 15),

  rateLimitLogin: intEnv("RATE_LIMIT_LOGIN", 10),
  rateLimitRegister: intEnv("RATE_LIMIT_REGISTER", 5),
  rateLimitOtp: intEnv("RATE_LIMIT_OTP", 3),
  adminRegistrationSecret: process.env.ADMIN_REGISTRATION_SECRET || "",

  currency: "SAR",
  timezone: "Asia/Riyadh",

  // Stripe was retired in favour of Moyasar. Kept dormant; not offered in the UI.
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",

  // AI assistant (Part 2 §2.3). Off unless explicitly enabled.
  aiAssistantEnabled: boolEnv("AI_ASSISTANT_ENABLED", false),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  aiModel: process.env.AI_MODEL || "claude-opus-5-5",
  aiEffort: ["low", "medium", "high", "xhigh", "max"].includes(process.env.AI_EFFORT) ? process.env.AI_EFFORT : "low",
  aiRateLimitPerHour: intEnv("AI_RATE_LIMIT_PER_HOUR", 30),

  // Moyasar — the only online payment provider.
  moyasarMode: (process.env.MOYASAR_MODE || "test").toLowerCase() === "live" ? "live" : "test",
  moyasarSecretKey: process.env.MOYASAR_SECRET_KEY || "",
  moyasarPublishableKey: process.env.MOYASAR_PUBLISHABLE_KEY || "",
  moyasarWebhookSecret: process.env.MOYASAR_WEBHOOK_SECRET || "",
  // Only overridden in tests (local mock server).
  moyasarApiBase: process.env.MOYASAR_API_BASE || "https://api.moyasar.com/v1",
  // How long a hosted-checkout invoice stays payable before it expires.
  moyasarInvoiceTtlMinutes: intEnv("MOYASAR_INVOICE_TTL_MINUTES", 60),
  paymentSuccessUrl:
    process.env.PAYMENT_SUCCESS_URL ||
    process.env.STRIPE_SUCCESS_URL ||
    "http://localhost:3000/user.html?payment=success",
  paymentCancelUrl:
    process.env.PAYMENT_CANCEL_URL ||
    process.env.STRIPE_CANCEL_URL ||
    "http://localhost:3000/user.html?payment=cancelled",

  // Analytics / marketing tags — front end loads them only when set.
  ga4MeasurementId: process.env.GA4_MEASUREMENT_ID || "",
  metaPixelId: process.env.META_PIXEL_ID || "",

  // Automated database backup.
  backupCron: process.env.BACKUP_CRON || "",
  backupRetentionDays: intEnv("BACKUP_RETENTION_DAYS", 14),
  mysqldumpPath: process.env.MYSQLDUMP_PATH || "mysqldump"
};

if (env.nodeEnv === "production") {
  const missing = [];
  if (!process.env.JWT_ACCESS_SECRET) missing.push("JWT_ACCESS_SECRET");
  if (!process.env.JWT_REFRESH_SECRET) missing.push("JWT_REFRESH_SECRET");
  if (!env.adminRegistrationSecret) missing.push("ADMIN_REGISTRATION_SECRET");
  if (!env.corsOrigin) missing.push("CORS_ORIGIN");
  if (missing.length > 0) {
    throw new Error(`Missing required production variables: ${missing.join(", ")}`);
  }
}

module.exports = { env };
