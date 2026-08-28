const express = require("express");
const settingsController = require("../controllers/settingsController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.get("/public", asyncHandler(settingsController.publicList));
router.get("/", authenticate, requireAdmin, requirePermission("settings:write"), asyncHandler(settingsController.list));
router.put("/", authenticate, requireAdmin, requirePermission("settings:write"), asyncHandler(settingsController.save));
router.post("/", authenticate, requireAdmin, requirePermission("settings:write"), asyncHandler(settingsController.save));

module.exports = router;
