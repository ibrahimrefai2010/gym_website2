const userRepository = require("../repositories/userRepository");
const sessionRepository = require("../repositories/sessionRepository");
const notificationRepository = require("../repositories/notificationRepository");
const { assertSaudiPhone, assertStrongPassword, cleanString, pagination } = require("../utils/validator");
const { createHttpError } = require("../utils/httpError");
const { refreshTokenFromRequest } = require("../utils/cookies");
const { createLog } = require("../utils/logger");

async function dashboard(req, res) {
  const data = await userRepository.getDashboard(req.user.id);
  res.json({ success: true, data });
}

async function me(req, res) {
  const data = userRepository.publicUser(await userRepository.findById(req.user.id));
  res.json({ success: true, data });
}

async function list(req, res) {
  const data = await userRepository.listUsers({
    ...pagination(req.query),
    search: req.query.search,
    status: req.query.status,
    membership: req.query.membership
  });
  res.json({ success: true, data });
}

async function detail(req, res) {
  const data = await userRepository.getUserDetails(req.params.id);
  res.json({ success: true, data });
}

async function updateProfile(req, res) {
  if (req.body.phone) {
    assertSaudiPhone(req.body.phone);
  }
  const data = await userRepository.updateProfile(req.user.id, {
    fullName: cleanString(req.body.fullName, 160),
    phone: req.body.phone
  });

  await createLog("user", req.user.id, "user.update", "users", req.user.id, null, req.ip);
  res.json({ success: true, data });
}

async function changePassword(req, res) {
  assertStrongPassword(req.body.nextPassword);
  const isChanged = await userRepository.changePassword(
    req.user.id,
    req.body.currentPassword,
    req.body.nextPassword
  );

  if (!isChanged) {
    throw createHttpError(400, "Current password is incorrect.", "PASSWORD_NOT_CHANGED");
  }

  let revokedOtherSessions = 0;
  if (req.user?.type === "user") {
    try {
      const revoked = await sessionRepository.revokeOthersForUser(req.user.id, refreshTokenFromRequest(req));
      revokedOtherSessions = revoked.revoked || 0;
      await notificationRepository.createForUser(req.user.id, {
        type: "password_changed",
        titleAr: "تم تغيير كلمة المرور",
        titleEn: "Your password was changed",
        bodyAr: "تم تغيير كلمة مرور حسابك. إذا لم تقم بذلك، تواصل مع النادي فوراً.",
        bodyEn: "Your account password was changed. If this was not you, contact the gym immediately."
      });
    } catch (_error) {
      // Non-critical: password change already succeeded.
    }
  }

  await createLog("user", req.user.id, "member.password_change", "users", req.user.id, null, req.ip);
  res.json({ success: true, data: { changed: true, revokedOtherSessions } });
}

module.exports = {
  changePassword,
  dashboard,
  detail,
  list,
  me,
  updateProfile
};
