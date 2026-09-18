const express = require("express");
const taskController = require("../controllers/taskController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { attachEffectiveBranch } = require("../middleware/adminBranchScope");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(authenticate, requireAdmin, attachEffectiveBranch);
router.get("/", requirePermission("tasks:manage"), asyncHandler(taskController.list));
router.post("/", requirePermission("tasks:manage"), asyncHandler(taskController.create));
router.get("/:id", requirePermission("tasks:manage"), asyncHandler(taskController.detail));
router.put("/:id", requirePermission("tasks:manage"), asyncHandler(taskController.update));
router.patch("/:id", requirePermission("tasks:manage"), asyncHandler(taskController.update));
router.patch("/:id/close", requirePermission("tasks:manage"), asyncHandler(taskController.close));
router.patch("/:id/cancel", requirePermission("tasks:manage"), asyncHandler(taskController.cancel));

module.exports = router;
