const express = require("express");
const invoiceController = require("../controllers/invoiceController");
const {
  authenticate,
  authenticateMedia,
  requireAdmin,
  requirePermission
} = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

// PDF is opened as a plain link / new tab, so it uses the cookie fallback
// (authenticateMedia) rather than requiring an Authorization header.
router.get(
  "/:id/pdf",
  authenticateMedia,
  requireAdmin,
  requirePermission("invoices:read"),
  asyncHandler(invoiceController.pdf)
);

router.use(authenticate, requireAdmin);
router.get("/", requirePermission("invoices:read"), asyncHandler(invoiceController.list));
router.get("/overdue", requirePermission("invoices:read"), asyncHandler(invoiceController.overdue));
router.post("/", requirePermission("invoices:write"), asyncHandler(invoiceController.create));
router.get("/:id", requirePermission("invoices:read"), asyncHandler(invoiceController.detail));
router.patch("/:id/status", requirePermission("invoices:write"), asyncHandler(invoiceController.updateStatus));

module.exports = router;
