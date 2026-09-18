const express = require("express");
const customerController = require("../controllers/customerController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { attachEffectiveBranch } = require("../middleware/adminBranchScope");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(authenticate, requireAdmin, attachEffectiveBranch);
router.get("/", requirePermission("customers:manage"), asyncHandler(customerController.list));
router.post("/", requirePermission("customers:manage"), asyncHandler(customerController.create));
router.get("/:id", requirePermission("customers:manage"), asyncHandler(customerController.detail));
router.put("/:id", requirePermission("customers:manage"), asyncHandler(customerController.update));
router.patch("/:id", requirePermission("customers:manage"), asyncHandler(customerController.update));

module.exports = router;
