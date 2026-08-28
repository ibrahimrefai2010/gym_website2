const express = require("express");
const rateLimit = require("express-rate-limit");
const messageController = require("../controllers/messageController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

const contactLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 1,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, error: "Please wait 10 minutes before sending another message." }
});

router.post("/", contactLimiter, asyncHandler(messageController.create));
router.get("/", authenticate, requireAdmin, requirePermission("messages:write"), asyncHandler(messageController.list));
router.put("/:id", authenticate, requireAdmin, requirePermission("messages:write"), asyncHandler(messageController.update));
router.delete("/:id", authenticate, requireAdmin, requirePermission("messages:write"), asyncHandler(messageController.remove));

module.exports = router;
