const express = require("express");
const rateLimit = require("express-rate-limit");
const messageController = require("../controllers/messageController");
const { authenticate, requireAdmin, requireAnyPermission, requirePermission } = require("../middleware/auth");
const { attachEffectiveBranch } = require("../middleware/adminBranchScope");
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
// Leads/CRM (Part 2): list is reachable by either the plain-inbox audience
// (messages:write) or the CRM-only audience (leads:read -- e.g. marketing,
// which can view the pipeline without inbox-triage rights). See
// middleware/auth.js's requireAnyPermission and messageController.list.
router.get("/", authenticate, requireAdmin, attachEffectiveBranch, requireAnyPermission("messages:write", "leads:read"), asyncHandler(messageController.list));
router.put("/:id", authenticate, requireAdmin, attachEffectiveBranch, requirePermission("messages:write"), asyncHandler(messageController.update));
router.delete("/:id", authenticate, requireAdmin, attachEffectiveBranch, requirePermission("messages:write"), asyncHandler(messageController.remove));

// Leads/CRM (Part 2): pipeline fields (lead_status/assigned_to), follow-up
// notes, and convert-to-member -- all gated by leads:write, whose catalog
// description ("Assign, update, note, convert, and export leads") already
// matches this exact set of actions.
router.patch("/:id/lead", authenticate, requireAdmin, attachEffectiveBranch, requirePermission("leads:write"), asyncHandler(messageController.updateLead));
router.get("/:id/notes", authenticate, requireAdmin, attachEffectiveBranch, requireAnyPermission("leads:read", "leads:write"), asyncHandler(messageController.listNotes));
router.post("/:id/notes", authenticate, requireAdmin, attachEffectiveBranch, requirePermission("leads:write"), asyncHandler(messageController.addNote));
router.post("/:id/convert", authenticate, requireAdmin, attachEffectiveBranch, requirePermission("leads:write"), asyncHandler(messageController.convert));

module.exports = router;
