const express = require("express");
const attendanceController = require("../controllers/attendanceController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(authenticate, requireAdmin);
router.get("/", requirePermission("attendance:manage"), asyncHandler(attendanceController.list));
router.post("/check-in", requirePermission("attendance:manage"), asyncHandler(attendanceController.checkIn));
router.patch("/:id/check-out", requirePermission("attendance:manage"), asyncHandler(attendanceController.checkOut));

module.exports = router;
