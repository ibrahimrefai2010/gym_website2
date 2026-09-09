const express = require("express");
const invoiceController = require("../controllers/invoiceController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(authenticate, requireAdmin);
router.get("/", requirePermission("invoices:read"), asyncHandler(invoiceController.list));
router.get("/overdue", requirePermission("invoices:read"), asyncHandler(invoiceController.overdue));
router.post("/", requirePermission("invoices:write"), asyncHandler(invoiceController.create));
router.get("/:id", requirePermission("invoices:read"), asyncHandler(invoiceController.detail));
router.get("/:id/pdf", requirePermission("invoices:read"), asyncHandler(invoiceController.pdf));
router.patch("/:id/status", requirePermission("invoices:write"), asyncHandler(invoiceController.updateStatus));

module.exports = router;
