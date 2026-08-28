const express = require("express");
const memberController = require("../controllers/memberController");
const userController = require("../controllers/userController");
const { authenticateMedia, requireAdmin, requirePermission } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

// Image endpoints hit by plain <img src> — cannot carry an Authorization header,
// so they accept the Bearer token when present and fall back to the refresh cookie.
router.get("/user/avatar", authenticateMedia, asyncHandler(memberController.getAvatar));
router.get(
  "/users/:id/avatar",
  authenticateMedia,
  requireAdmin,
  requirePermission("users:read"),
  asyncHandler(userController.memberAvatar)
);

module.exports = router;
