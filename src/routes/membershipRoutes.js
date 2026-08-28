const express = require("express");
const membershipController = require("../controllers/membershipController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.get("/", authenticate, requireAdmin, requirePermission("memberships:read"), asyncHandler(membershipController.list));
router.post("/buy", authenticate, asyncHandler(membershipController.buy));
router.get("/me", authenticate, asyncHandler(membershipController.mine));
router.patch("/:id/activate", authenticate, requireAdmin, requirePermission("memberships:write"), asyncHandler(membershipController.activate));
router.patch("/:id/cancel", authenticate, requireAdmin, requirePermission("memberships:write"), asyncHandler(membershipController.cancel));
router.patch("/:id/action", authenticate, requireAdmin, requirePermission("memberships:write"), asyncHandler(membershipController.action));

module.exports = router;
