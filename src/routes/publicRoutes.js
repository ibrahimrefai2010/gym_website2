const express = require("express");
const publicController = require("../controllers/publicController");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.get("/health", asyncHandler(publicController.health));
router.get("/bootstrap", asyncHandler(publicController.bootstrap));
router.get("/card/:token", asyncHandler(publicController.verifyCard));

module.exports = router;
