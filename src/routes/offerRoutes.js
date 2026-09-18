const express = require("express");
const offerController = require("../controllers/offerController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { attachEffectiveBranch } = require("../middleware/adminBranchScope");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler(offerController.list));
router.post(
  "/",
  authenticate,
  requireAdmin,
  attachEffectiveBranch,
  requirePermission("offers:write"),
  asyncHandler(offerController.create)
);
router.put(
  "/:id",
  authenticate,
  requireAdmin,
  attachEffectiveBranch,
  requirePermission("offers:write"),
  asyncHandler(offerController.update)
);
router.delete("/:id", authenticate, requireAdmin, requirePermission("offers:write"), asyncHandler(offerController.remove));

module.exports = router;
