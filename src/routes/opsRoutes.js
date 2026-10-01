const express = require("express");
const opsController = require("../controllers/opsController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { attachEffectiveBranch } = require("../middleware/adminBranchScope");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();
router.use(authenticate, requireAdmin, attachEffectiveBranch);
router.get("/audit-logs", requirePermission("audit_logs:read"), asyncHandler(opsController.auditLogs));
router.get("/audit-logs/export", requirePermission("audit_logs:read"), asyncHandler(opsController.exportAuditLogs));
router.get("/feed", requirePermission("dashboard:read"), asyncHandler(opsController.feed));
router.post("/feed/seen", requirePermission("dashboard:read"), asyncHandler(opsController.markFeedSeen));

module.exports = router;
