const express = require("express");
const paymentController = require("../controllers/paymentController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { attachEffectiveBranch } = require("../middleware/adminBranchScope");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.post("/webhook/:provider?", asyncHandler(paymentController.webhook));
router.post("/checkout", authenticate, asyncHandler(paymentController.createCheckout));
router.post("/create-intent", authenticate, asyncHandler(paymentController.createIntent));
router.get("/history", authenticate, asyncHandler(paymentController.history));
router.patch(
  "/:id/complete",
  authenticate,
  requireAdmin,
  attachEffectiveBranch,
  requirePermission("payments:write"),
  asyncHandler(paymentController.complete)
);

module.exports = router;
