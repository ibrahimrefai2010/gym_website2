const userRepository = require("../repositories/userRepository");
const sessionRepository = require("../repositories/sessionRepository");
const notificationRepository = require("../repositories/notificationRepository");
const settingsRepository = require("../repositories/settingsRepository");
const memberPortalRepository = require("../repositories/memberPortalRepository");
const memberExportService = require("../services/memberExportService");
const avatarService = require("../services/avatarService");
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

async function memberAvatar(req, res) {
  const memberId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(memberId) || memberId < 1) {
    throw createHttpError(400, "Invalid member id.", "INVALID_ID");
  }
  const storedName = await memberPortalRepository.getAvatarPath(memberId);
  const file = storedName ? await avatarService.readAvatar(storedName) : null;
  if (!file) {
    throw createHttpError(404, "No profile photo set.", "AVATAR_NOT_FOUND");
  }
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
  return res.send(file.buffer);
}

async function exportMembers(req, res) {
  const format = String(req.query.format || "xlsx").toLowerCase() === "pdf" ? "pdf" : "xlsx";
  const lang = String(req.query.lang || "en").toLowerCase() === "ar" ? "ar" : "en";
  const rows = await userRepository.exportMembers({ limit: req.query.limit });
  const stamp = new Date().toISOString().slice(0, 10);

  await createLog("admin", req.user?.id, "members.export", "users", null, { format, count: rows.length }, req.ip);

  if (format === "pdf") {
    let gymName = "Muscle and Fitness Center";
    try {
      const settings = await settingsRepository.publicSettings(req.user?.branchId || 1);
      gymName = (lang === "ar" ? settings.gym_name_ar : settings.gym_name_en) || gymName;
    } catch (_error) {
      /* fall back to default name */
    }
    const buffer = await memberExportService.buildPdf(rows, lang, { gymName });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="members-${stamp}.pdf"`);
    return res.send(buffer);
  }

  const buffer = await memberExportService.buildWorkbook(rows, lang);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="members-${stamp}.xlsx"`);
  return res.send(Buffer.from(buffer));
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
  exportMembers,
  memberAvatar,
  list,
  me,
  updateProfile
};
