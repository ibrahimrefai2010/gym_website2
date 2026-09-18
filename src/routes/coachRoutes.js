const express = require("express");
const coachController = require("../controllers/coachController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { attachEffectiveBranch } = require("../middleware/adminBranchScope");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(authenticate, requireAdmin, attachEffectiveBranch);
router.get("/", requirePermission("coaches:manage"), asyncHandler(coachController.list));
router.post("/", requirePermission("coaches:manage"), asyncHandler(coachController.create));
router.get("/:id", requirePermission("coaches:manage"), asyncHandler(coachController.detail));
router.put("/:id", requirePermission("coaches:manage"), asyncHandler(coachController.update));
router.delete("/:id", requirePermission("coaches:manage"), asyncHandler(coachController.remove));
router.post("/:id/assign", requirePermission("coaches:manage"), asyncHandler(coachController.assign));
router.delete("/members/:userId/assignment", requirePermission("coaches:manage"), asyncHandler(coachController.unassign));

module.exports = router;
