const express = require("express");
const controller = require("../controllers/dataTransferController");
const { authenticate, requireAdmin, requirePermission, requireAnyPermission } = require("../middleware/auth");
const { attachEffectiveBranch } = require("../middleware/adminBranchScope");
const { asyncHandler } = require("../utils/asyncHandler");

// Mounted at /api/v1/data. Exports respect the effective branch; imports
// write only to it.
const router = express.Router();
router.use(authenticate, requireAdmin, attachEffectiveBranch);

router.get("/exports/leads", requireAnyPermission("leads:read", "leads:write", "messages:write"), asyncHandler(controller.exportLeads));
router.get("/exports/tasks", requirePermission("tasks:manage"), asyncHandler(controller.exportTasks));
router.get("/exports/attendance", requireAnyPermission("attendance:manage", "checkin:manage"), asyncHandler(controller.exportAttendance));
router.get("/exports/backup", asyncHandler(controller.exportBackup));

router.get("/imports/:entity/template", requirePermission("customers:manage"), asyncHandler(controller.importTemplate));
router.post("/imports/:entity/preview", requirePermission("customers:manage"), asyncHandler(controller.importPreview));
router.post("/imports/:entity/:jobId/commit", requirePermission("customers:manage"), asyncHandler(controller.importCommit));

module.exports = router;
