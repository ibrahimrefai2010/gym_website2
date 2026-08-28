const express = require("express");
const branchController = require("../controllers/branchController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(authenticate, requireAdmin);
router.get("/", requirePermission("branches:manage"), asyncHandler(branchController.list));
router.post("/", requirePermission("branches:manage"), asyncHandler(branchController.create));
router.put("/:id", requirePermission("branches:manage"), asyncHandler(branchController.update));
router.delete("/:id", requirePermission("branches:manage"), asyncHandler(branchController.remove));

module.exports = router;
