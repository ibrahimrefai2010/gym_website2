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
router.get(
  "/",
  authenticate,
  requireAdmin,
  attachEffectiveBranch,
  requirePermission("payments:read"),
  asyncHandler(paymentController.adminList)
);
router.get(
  "/export",
  authenticate,
  requireAdmin,
  attachEffectiveBranch,
  requirePermission("payments:read"),
  asyncHandler(paymentController.adminExport)
);
router.post(
  "/manual",
  authenticate,
  requireAdmin,
  attachEffectiveBranch,
  requirePermission("payments:write"),
  asyncHandler(paymentController.recordManual)
);
router.get("/:id(\\d+)/status", authenticate, asyncHandler(paymentController.status));
router.patch(
  "/:id/complete",
  authenticate,
  requireAdmin,
  attachEffectiveBranch,
  requirePermission("payments:write"),
  asyncHandler(paymentController.complete)
);

module.exports = router;
