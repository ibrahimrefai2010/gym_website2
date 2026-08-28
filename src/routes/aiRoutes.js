const express = require("express");
const aiController = require("../controllers/aiController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(authenticate, requireAdmin);
router.post("/assistant", requirePermission("ai:manage"), asyncHandler(aiController.ask));

module.exports = router;
