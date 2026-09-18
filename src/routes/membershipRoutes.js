const express = require("express");
const membershipController = require("../controllers/membershipController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { attachEffectiveBranch } = require("../middleware/adminBranchScope");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.get(
  "/",
  authenticate,
  requireAdmin,
  attachEffectiveBranch,
  requirePermission("memberships:read"),
  asyncHandler(membershipController.list)
);
router.post("/buy", authenticate, asyncHandler(membershipController.buy));
router.get("/me", authenticate, asyncHandler(membershipController.mine));
router.patch(
  "/:id/activate",
  authenticate,
  requireAdmin,
  attachEffectiveBranch,
  requirePermission("memberships:write"),
  asyncHandler(membershipController.activate)
);
router.patch(
  "/:id/cancel",
  authenticate,
  requireAdmin,
  attachEffectiveBranch,
  requirePermission("memberships:write"),
  asyncHandler(membershipController.cancel)
);
router.patch(
  "/:id/action",
  authenticate,
  requireAdmin,
  attachEffectiveBranch,
  requirePermission("memberships:write"),
  asyncHandler(membershipController.action)
);

module.exports = router;
