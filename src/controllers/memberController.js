const memberPortalService = require("../services/memberPortalService");
const memberPortalRepository = require("../repositories/memberPortalRepository");
const notificationRepository = require("../repositories/notificationRepository");
const sessionRepository = require("../repositories/sessionRepository");
const { clearRefreshCookie, refreshTokenFromRequest } = require("../utils/cookies");
const { assertSaudiPhone, cleanString, positiveInteger } = require("../utils/validator");
const { createHttpError } = require("../utils/httpError");
const { createLog } = require("../utils/logger");

const GENDERS = ["male", "female", "other", "unspecified"];

function parsePositiveIntParam(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw createHttpError(400, `${label} is invalid.`, "INVALID_ID");
  }
  return parsed;
}

function cleanNationalId(value) {
  const raw = String(value == null ? "" : value).replace(/[^0-9]/g, "");
  if (!raw) {
    return "";
  }
  if (raw.length < 8 || raw.length > 15) {
    throw createHttpError(422, "Enter a valid National ID / Iqama number.", "INVALID_NATIONAL_ID");
  }
  return raw;
}

function cleanBirthDate(value) {
  if (value == null || value === "") {
    return undefined;
  }
  const raw = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw createHttpError(422, "Enter a valid date of birth.", "INVALID_BIRTH_DATE");
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  const now = new Date();
  if (Number.isNaN(date.getTime()) || date > now) {
    throw createHttpError(422, "Enter a valid date of birth.", "INVALID_BIRTH_DATE");
  }
  const years = (now - date) / (365.25 * 24 * 60 * 60 * 1000);
  if (years > 120) {
    throw createHttpError(422, "Enter a valid date of birth.", "INVALID_BIRTH_DATE");
  }
  return raw;
}

async function dashboard(req, res) {
  const data = await memberPortalService.getDashboard(req.user.id);
  res.json({ success: true, data });
}

async function getProfile(req, res) {
  const data = await memberPortalService.getProfileView(req.user.id);
  res.json({ success: true, data });
}

async function updateProfile(req, res) {
  const body = req.body || {};
  const payload = {};

  if (body.fullName !== undefined) {
    const fullName = cleanString(body.fullName, 160);
    if (!fullName) {
      throw createHttpError(422, "Full name is required.", "INVALID_NAME");
    }
    payload.fullName = fullName;
  }
  if (body.phone !== undefined && body.phone !== "") {
    assertSaudiPhone(body.phone);
    payload.phone = String(body.phone).replace(/[^\d+]/g, "");
  }
  if (body.gender !== undefined) {
    payload.gender = GENDERS.includes(body.gender) ? body.gender : "unspecified";
  }
  if (body.nationalId !== undefined) {
    payload.nationalId = cleanNationalId(body.nationalId) || null;
  }
  const birthDate = cleanBirthDate(body.birthDate);
  if (birthDate !== undefined) {
    payload.birthDate = birthDate;
  }
  if (body.nationality !== undefined) {
    payload.nationality = cleanString(body.nationality, 80);
  }
  if (body.address !== undefined) {
    payload.address = cleanString(body.address, 255);
  }
  if (body.city !== undefined) {
    payload.city = cleanString(body.city, 120);
  }
  if (body.country !== undefined) {
    payload.country = cleanString(body.country, 120);
  }

  await memberPortalRepository.updatePersonalInfo(req.user.id, payload);
  await createLog("user", req.user.id, "member.profile_update", "users", req.user.id, null, req.ip);
  const data = await memberPortalService.getProfileView(req.user.id);
  res.json({ success: true, data });
}

async function updateEmergencyContact(req, res) {
  const body = req.body || {};
  await memberPortalRepository.upsertEmergencyContact(req.user.id, {
    name: cleanString(body.name, 160),
    phone: String(body.phone || "").replace(/[^\d+]/g, "").slice(0, 40),
    relationship: cleanString(body.relationship, 80)
  });
  await createLog("user", req.user.id, "member.emergency_contact_update", "users", req.user.id, null, req.ip);
  const data = await memberPortalService.getProfileView(req.user.id);
  res.json({ success: true, data });
}

async function membership(req, res) {
  const data = await memberPortalService.getMembershipView(req.user.id);
  const memberSince = await memberPortalRepository.getMemberSince(req.user.id);
  res.json({ success: true, data: { ...data, memberSince } });
}

async function membershipHistory(req, res) {
  const data = await memberPortalRepository.getMembershipHistory(req.user.id);
  res.json({ success: true, data });
}

async function payments(req, res) {
  const data = await memberPortalRepository.getPayments(req.user.id, {
    page: positiveInteger(req.query.page, 1, 100000),
    pageSize: positiveInteger(req.query.pageSize, 20, 50)
  });
  res.json({ success: true, data });
}

async function paymentReceipt(req, res) {
  const paymentId = parsePositiveIntParam(req.params.id, "Payment id");
  const data = await memberPortalRepository.getPaymentReceipt(req.user.id, paymentId);
  res.json({ success: true, data });
}

async function card(req, res) {
  const data = await memberPortalService.getCard(req.user.id);
  res.json({ success: true, data });
}

async function notifications(req, res) {
  const data = await notificationRepository.listForUser(req.user.id, {
    page: positiveInteger(req.query.page, 1, 100000),
    pageSize: positiveInteger(req.query.pageSize, 20, 50),
    unreadOnly: String(req.query.unreadOnly || "") === "true"
  });
  res.json({ success: true, data });
}

async function markNotificationRead(req, res) {
  const notificationId = parsePositiveIntParam(req.params.id, "Notification id");
  const data = await notificationRepository.markRead(req.user.id, notificationId);
  res.json({ success: true, data });
}

async function markAllNotificationsRead(req, res) {
  const data = await notificationRepository.markAllRead(req.user.id);
  res.json({ success: true, data });
}

async function getNotificationPreferences(req, res) {
  const data = await notificationRepository.getPreferences(req.user.id);
  res.json({ success: true, data });
}

async function updateNotificationPreferences(req, res) {
  const data = await notificationRepository.updatePreferences(req.user.id, req.body || {});
  await createLog("user", req.user.id, "member.notification_prefs_update", "users", req.user.id, null, req.ip);
  res.json({ success: true, data });
}

async function listSessions(req, res) {
  const data = await sessionRepository.listForUser(req.user.id, refreshTokenFromRequest(req));
  res.json({ success: true, data });
}

async function revokeSession(req, res) {
  const sessionId = parsePositiveIntParam(req.params.id, "Session id");
  const result = await sessionRepository.revokeForUser(req.user.id, sessionId, refreshTokenFromRequest(req));
  if (result.wasCurrent) {
    clearRefreshCookie(res);
  }
  await createLog("user", req.user.id, "member.session_revoke", "refresh_tokens", sessionId, null, req.ip);
  res.json({ success: true, data: result });
}

async function revokeOtherSessions(req, res) {
  const result = await sessionRepository.revokeOthersForUser(req.user.id, refreshTokenFromRequest(req));
  await createLog("user", req.user.id, "member.session_revoke_others", "refresh_tokens", null, result, req.ip);
  res.json({ success: true, data: result });
}

module.exports = {
  card,
  dashboard,
  getNotificationPreferences,
  getProfile,
  listSessions,
  markAllNotificationsRead,
  markNotificationRead,
  membership,
  membershipHistory,
  notifications,
  paymentReceipt,
  payments,
  revokeOtherSessions,
  revokeSession,
  updateEmergencyContact,
  updateNotificationPreferences,
  updateProfile
};
