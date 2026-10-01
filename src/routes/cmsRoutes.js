const express = require("express");
const cmsController = require("../controllers/cmsController");
const rbacRepository = require("../repositories/rbacRepository");
const { authenticate, requireAdmin, requireAnyPermission } = require("../middleware/auth");
const { attachEffectiveBranch } = require("../middleware/adminBranchScope");
const { asyncHandler } = require("../utils/asyncHandler");
const { createHttpError } = require("../utils/httpError");

const router = express.Router();
const contentAdmin = requireAnyPermission("cms:manage", "settings:write", "website:manage");

// Reordering a list needs the permission that edits that list.
const ORDER_PERMISSIONS = { plans: ["plans:write"], offers: ["offers:write"], slides: ["settings:write", "cms:manage"], faqs: ["settings:write", "cms:manage"] };
async function canReorder(req, _res, next) {
  try {
    const keys = ORDER_PERMISSIONS[req.params.type] || [];
    for (const key of keys) {
      if (await rbacRepository.hasPermission(req.user.id, req.user.role, key)) return next();
    }
    return next(createHttpError(403, "Your admin role cannot change this list.", "PERMISSION_DENIED"));
  } catch (error) {
    return next(error);
  }
}

router.use(authenticate, requireAdmin, attachEffectiveBranch);
router.get("/contact", contentAdmin, asyncHandler(cmsController.getContact));
router.put("/contact", contentAdmin, asyncHandler(cmsController.saveContact));
router.get("/faqs", contentAdmin, asyncHandler(cmsController.listFaqs));
router.post("/faqs", contentAdmin, asyncHandler(cmsController.saveFaq));
router.delete("/faqs/:id", contentAdmin, asyncHandler(cmsController.deleteFaq));
router.put("/order/:type", canReorder, asyncHandler(cmsController.reorder));

module.exports = router;
