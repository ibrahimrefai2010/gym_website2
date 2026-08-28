const express = require("express");
const searchController = require("../controllers/searchController");
const { authenticate, requireAdmin, requirePermission } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(authenticate, requireAdmin);
router.get("/", requirePermission("users:read"), asyncHandler(searchController.search));

module.exports = router;
