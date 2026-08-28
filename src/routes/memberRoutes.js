const express = require("express");
const memberController = require("../controllers/memberController");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.get("/dashboard", asyncHandler(memberController.dashboard));

router.get("/profile", asyncHandler(memberController.getProfile));
router.patch("/profile", asyncHandler(memberController.updateProfile));
router.put("/emergency-contact", asyncHandler(memberController.updateEmergencyContact));
router.post("/avatar", asyncHandler(memberController.uploadAvatar));
router.delete("/avatar", asyncHandler(memberController.deleteAvatar));

router.get("/membership", asyncHandler(memberController.membership));
router.get("/membership/history", asyncHandler(memberController.membershipHistory));

router.get("/payments", asyncHandler(memberController.payments));
router.get("/payments/:id/receipt", asyncHandler(memberController.paymentReceipt));

router.get("/card", asyncHandler(memberController.card));

router.get("/notifications", asyncHandler(memberController.notifications));
router.post("/notifications/read-all", asyncHandler(memberController.markAllNotificationsRead));
router.post("/notifications/:id/read", asyncHandler(memberController.markNotificationRead));
router.get("/notifications/preferences", asyncHandler(memberController.getNotificationPreferences));
router.put("/notifications/preferences", asyncHandler(memberController.updateNotificationPreferences));

router.get("/sessions", asyncHandler(memberController.listSessions));
router.post("/sessions/revoke-others", asyncHandler(memberController.revokeOtherSessions));
router.delete("/sessions/:id", asyncHandler(memberController.revokeSession));

module.exports = router;
