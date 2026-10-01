const express = require("express");
const expenseController = require("../controllers/expenseController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { attachEffectiveBranch } = require("../middleware/adminBranchScope");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(authenticate, requireAdmin, attachEffectiveBranch);
router.get("/categories", requirePermission("expenses:manage"), asyncHandler(expenseController.categories));
router.get("/", requirePermission("expenses:manage"), asyncHandler(expenseController.list));
router.post("/", requirePermission("expenses:manage"), asyncHandler(expenseController.create));
router.patch("/:id", requirePermission("expenses:manage"), asyncHandler(expenseController.update));

module.exports = router;
