const express = require("express");
const documentController = require("../controllers/documentController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(authenticate, requireAdmin);
router.get("/", requirePermission("documents:manage"), asyncHandler(documentController.list));
router.post("/", requirePermission("documents:manage"), asyncHandler(documentController.create));

module.exports = router;
