const express = require("express");
const adminController = require("../controllers/adminController");
const { requirePermission, requireAnyPermission } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.get("/overview", requirePermission("dashboard:read"), asyncHandler(adminController.overview));
router.get("/rbac", requirePermission("permissions:manage"), asyncHandler(adminController.rbac));
router.post("/rbac/sync", requirePermission("permissions:manage"), asyncHandler(adminController.syncRbac));
router.get("/backups", requirePermission("backups:read"), asyncHandler(adminController.listBackups));
router.post("/backups", requirePermission("backups:write"), asyncHandler(adminController.createBackup));
router.post("/users", requirePermission("roles:manage"), asyncHandler(adminController.createAdmin));
// Coach photos and CMS images are uploaded by admins who manage those areas,
// not only by settings admins.
router.post(
  "/uploads/images",
  requireAnyPermission("settings:write", "cms:manage", "website:manage", "coaches:manage"),
  asyncHandler(adminController.uploadImage)
);
router.get("/:resource", asyncHandler(adminController.list));
router.post("/:resource", asyncHandler(adminController.save));
router.patch("/:resource", asyncHandler(adminController.save));

module.exports = router;
