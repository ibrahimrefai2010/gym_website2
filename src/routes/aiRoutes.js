const express = require("express");
const rateLimit = require("express-rate-limit");
const aiController = require("../controllers/aiController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { attachEffectiveBranch } = require("../middleware/adminBranchScope");
const { asyncHandler } = require("../utils/asyncHandler");
const { env } = require("../config/env");

const router = express.Router();

// Per-admin (not per-IP) limit: every question can cost a model call.
const askLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.aiRateLimitPerHour,
  keyGenerator: (req) => `ai:${req.user?.id || req.ip}`,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, error: "Too many assistant questions. Try again later." }
});

router.use(authenticate, requireAdmin, attachEffectiveBranch);
router.get("/status", requirePermission("dashboard:read"), asyncHandler(aiController.status));
router.get("/insights", requirePermission("dashboard:read"), asyncHandler(aiController.insights));
router.post("/assistant", requirePermission("ai:manage"), askLimiter, asyncHandler(aiController.ask));

module.exports = router;
