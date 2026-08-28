const express = require("express");
const authController = require("../controllers/authController");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.post("/login", asyncHandler(authController.login));
router.post("/register", asyncHandler(authController.register));
router.post("/forgot-password", asyncHandler(authController.forgotPassword));
router.post("/verify-otp", asyncHandler(authController.verifyOtp));
router.post("/reset-password", asyncHandler(authController.resetPassword));
router.post("/refresh", asyncHandler(authController.refresh));
router.post("/logout", asyncHandler(authController.logout));

module.exports = router;
