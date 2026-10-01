const express = require("express");
const reportController = require("../controllers/reportController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { attachEffectiveBranch } = require("../middleware/adminBranchScope");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

// attachEffectiveBranch: every report is scoped to the server-derived branch
// (or, with ?scope=all, consolidated -- cross-branch admins only). See
// reportController.resolveReportBranchIds.
router.use(authenticate, requireAdmin, attachEffectiveBranch);
router.get("/summary", requirePermission("reports:read"), asyncHandler(reportController.summary));
router.get("/revenue", requirePermission("reports:read"), asyncHandler(reportController.revenue));
router.get("/revenue-annual", requirePermission("reports:read"), asyncHandler(reportController.annual));
router.get("/churn", requirePermission("reports:read"), asyncHandler(reportController.churn));
// VAT and Zakat are internal accountant tools.
router.get("/vat", requirePermission("tax_reports:read"), asyncHandler(reportController.vat));
router.get("/zakat", requirePermission("tax_reports:read"), asyncHandler(reportController.zakat));
router.put("/zakat", requirePermission("tax_reports:read"), asyncHandler(reportController.saveZakat));

module.exports = router;
