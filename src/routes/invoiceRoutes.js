const express = require("express");
const invoiceController = require("../controllers/invoiceController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(authenticate, requireAdmin);
router.get("/", requirePermission("invoices:read"), asyncHandler(invoiceController.list));
router.post("/", requirePermission("invoices:write"), asyncHandler(invoiceController.create));
router.get("/:id", requirePermission("invoices:read"), asyncHandler(invoiceController.detail));
router.patch("/:id/status", requirePermission("invoices:write"), asyncHandler(invoiceController.updateStatus));

module.exports = router;
