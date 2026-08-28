const { requireAdmin, requirePermission, requireRole } = require("../../src/middleware/auth");

module.exports = {
  requireAdmin,
  requirePermission,
  requireRole
};
