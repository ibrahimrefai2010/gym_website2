const path = require("path");
const cors = require("cors");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { env } = require("./config/env");
const { authenticate, requireAdmin } = require("./middleware/auth");
const { resolveBranch } = require("./middleware/branchResolver");
const { errorHandler, notFound } = require("./middleware/errorHandler");
const publicRoutes = require("./routes/publicRoutes");
const authRoutes = require("./routes/authRoutes");
const adminAuthRoutes = require("./routes/adminAuthRoutes");
const userRoutes = require("./routes/userRoutes");
const memberRoutes = require("./routes/memberRoutes");
const mediaRoutes = require("./routes/mediaRoutes");
const adminRoutes = require("./routes/adminRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const planRoutes = require("./routes/planRoutes");
const offerRoutes = require("./routes/offerRoutes");
const messageRoutes = require("./routes/messageRoutes");
const membershipRoutes = require("./routes/membershipRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const branchRoutes = require("./routes/branchRoutes");
const customerRoutes = require("./routes/customerRoutes");
const invoiceRoutes = require("./routes/invoiceRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");
const documentRoutes = require("./routes/documentRoutes");
const reportRoutes = require("./routes/reportRoutes");
const searchRoutes = require("./routes/searchRoutes");
const aiRoutes = require("./routes/aiRoutes");

const app = express();
const publicDir = path.join(__dirname, "..", "public");

function rateMessage(message) {
  return { success: false, error: message };
}

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: rateMessage("Too many requests. Please try again shortly.")
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.rateLimitLogin,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: rateMessage("Too many login attempts. Try again shortly.")
});

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: rateMessage("Too many admin login attempts. Try again shortly.")
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.rateLimitRegister,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: rateMessage("Too many registration attempts. Try again later.")
});

const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.rateLimitOtp,
  keyGenerator: (req) => String(req.body?.identifier || req.ip),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: rateMessage("Too many OTP requests. Try again later.")
});

app.disable("x-powered-by");
app.set("trust proxy", 1);

// Subdomain branch routing (women.<domain> vs the bare domain) means the app
// may need to allow more than one origin. CORS_ORIGIN can be a single URL or
// a comma-separated list (see .env.example); a list gets a validating
// origin-callback instead of a bare string.
const allowedOrigins = String(env.corsOrigin || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions =
  allowedOrigins.length > 1
    ? {
        origin(origin, callback) {
          // No Origin header (curl, server-to-server, same-origin) -- allow.
          if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
          }
          return callback(new Error("Not allowed by CORS"));
        },
        credentials: true
      }
    : { origin: allowedOrigins[0] || env.corsOrigin, credentials: true };

app.use(helmet());
app.use(cors(corsOptions));
app.use("/api/v1/payments/webhook", express.raw({ type: "application/json", limit: "100kb" }));
app.use("/api/v1/admin/uploads/images", express.json({ limit: "6mb" }));
app.use("/api/v1/user/avatar", express.json({ limit: "3mb" }));
app.use(express.json({ limit: "10kb" }));
app.use("/api/", generalLimiter);
app.use("/api/v1/auth/login", loginLimiter);
app.use("/api/v1/auth/register", registerLimiter);
app.use("/api/v1/auth/forgot-password", otpLimiter);
app.use("/api/v1/admin/auth/login", adminLoginLimiter);

app.use(
  express.static(publicDir, {
    extensions: ["html"],
    maxAge: env.nodeEnv === "production" ? "1h" : 0
  })
);

// Resolves req.branch = {id, code} for public/unauthenticated routes from
// the request subdomain (see middleware/branchResolver.js). Mounted before
// every public route that needs it (bootstrap, public plan/offer listings,
// register). Authenticated routes ignore req.branch entirely -- they use
// req.user.branchId instead, set by authenticate() from the DB principal.
app.use(resolveBranch);

app.use("/api/v1/public", publicRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/admin/auth", adminAuthRoutes);
app.use("/api/v1/settings", settingsRoutes);
app.use("/api/v1/plans", planRoutes);
app.use("/api/v1/offers", offerRoutes);
app.use("/api/v1/messages", messageRoutes);
app.use("/api/v1/memberships", membershipRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/branches", branchRoutes);
app.use("/api/v1/customers", customerRoutes);
app.use("/api/v1/invoices", invoiceRoutes);
app.use("/api/v1/expenses", expenseRoutes);
app.use("/api/v1/attendance", attendanceRoutes);
app.use("/api/v1/documents", documentRoutes);
app.use("/api/v1/reports", reportRoutes);
app.use("/api/v1/search", searchRoutes);
app.use("/api/v1/ai", aiRoutes);
app.use("/api/v1", mediaRoutes);
app.use("/api/v1/user", authenticate, memberRoutes);
app.use("/api/v1/user", authenticate, userRoutes);
app.use("/api/v1/users", authenticate, requireAdmin, userRoutes);
app.use("/api/v1/admin", authenticate, requireAdmin, adminRoutes);

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use("/api", notFound);
app.use(errorHandler);

module.exports = app;
