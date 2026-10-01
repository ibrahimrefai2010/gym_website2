const express = require("express");
const attendanceController = require("../controllers/attendanceController");
const { authenticate, requireAdmin, requireAnyPermission } = require("../middleware/auth");
const { attachEffectiveBranch } = require("../middleware/adminBranchScope");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

// attendance:manage (existing attendance/QR management) and checkin:manage
// (reception -- see brief: "a separate permission checkin:manage already
// exists in the catalog but is never referenced by any route") can both
// reach every route here, same requireAnyPermission OR-gate pattern
// messageRoutes already uses for messages:write/leads:read. attachEffectiveBranch
// makes req.effectiveBranchId available so every handler here is
// branch-scoped the same way tasks/coaches are, closing the gap where this
// router previously trusted a client-supplied branchId query param.
router.use(authenticate, requireAdmin, attachEffectiveBranch);

const canManage = requireAnyPermission("attendance:manage", "checkin:manage");

router.get("/", canManage, asyncHandler(attendanceController.list));
router.get("/daily-log", canManage, asyncHandler(attendanceController.dailyLog));
router.get("/heatmap", canManage, asyncHandler(attendanceController.heatmap));
router.get("/summary", canManage, asyncHandler(attendanceController.summary));
router.post("/check-in", canManage, asyncHandler(attendanceController.checkIn));
router.patch("/:id/check-out", canManage, asyncHandler(attendanceController.checkOut));

module.exports = router;
