const express = require("express");
const userController = require("../controllers/userController");
const { requireAdmin, requirePermission } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.get("/dashboard", asyncHandler(userController.dashboard));
router.get("/me", asyncHandler(userController.me));
router.put("/me", asyncHandler(userController.updateProfile));
router.patch("/profile", asyncHandler(userController.updateProfile));
router.patch("/password", asyncHandler(userController.changePassword));
router.get("/", requireAdmin, requirePermission("users:read"), asyncHandler(userController.list));
router.get("/export", requireAdmin, requirePermission("users:read"), asyncHandler(userController.exportMembers));
router.get("/:id", requireAdmin, requirePermission("users:read"), asyncHandler(userController.detail));

module.exports = router;
