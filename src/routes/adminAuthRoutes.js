const express = require("express");
const authController = require("../controllers/authController");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.post("/login", asyncHandler(authController.adminLogin));
router.post("/logout", asyncHandler(authController.logout));
router.post("/refresh", asyncHandler(authController.refresh));
router.post(
  "/change-password",
  authenticate,
  requireAdmin,
  asyncHandler(authController.adminChangePassword)
);

module.exports = router;
