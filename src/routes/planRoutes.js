const express = require("express");
const planController = require("../controllers/planController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler(planController.list));
router.post("/", authenticate, requireAdmin, requirePermission("plans:write"), asyncHandler(planController.create));
router.put("/:id", authenticate, requireAdmin, requirePermission("plans:write"), asyncHandler(planController.update));
router.delete("/:id", authenticate, requireAdmin, requirePermission("plans:write"), asyncHandler(planController.remove));

module.exports = router;
