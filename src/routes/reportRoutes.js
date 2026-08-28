const express = require("express");
const reportController = require("../controllers/reportController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(authenticate, requireAdmin);
router.get("/summary", requirePermission("reports:read"), asyncHandler(reportController.summary));
router.get("/revenue", requirePermission("reports:read"), asyncHandler(reportController.revenue));

module.exports = router;
