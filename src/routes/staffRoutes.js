const express = require("express");
const staffController = require("../controllers/staffController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { attachEffectiveBranch } = require("../middleware/adminBranchScope");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();
router.use(authenticate, requireAdmin, attachEffectiveBranch, requirePermission("roles:manage"));
router.get("/", asyncHandler(staffController.list));
router.post("/", asyncHandler(staffController.create));
router.patch("/:id(\\d+)", asyncHandler(staffController.update));
router.post("/:id(\\d+)/reset-password", asyncHandler(staffController.resetPassword));

module.exports = router;
