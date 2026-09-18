const { resolveEffectiveBranchId } = require("../security/branchAccess");

// Attaches req.effectiveBranchId -- the branch admin data-listing routes
// should filter by. Must run after authenticate()/requireAdmin() so
// req.user is populated. See src/security/branchAccess.js for the
// switch/no-switch resolution rules.
async function attachEffectiveBranch(req, _res, next) {
  try {
    req.effectiveBranchId = await resolveEffectiveBranchId(req);
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { attachEffectiveBranch };
