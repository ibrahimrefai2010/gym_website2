const QRCode = require("qrcode");
const { env } = require("../config/env");
const memberPortalRepository = require("../repositories/memberPortalRepository");
const notificationRepository = require("../repositories/notificationRepository");
const { createHttpError } = require("../utils/httpError");
const { appLogger } = require("../utils/logger");

const EXPIRING_SOON_DAYS = 7;

function todayInTimezone() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function toDateString(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function daysBetween(fromDateString, toDateString_) {
  const from = new Date(`${fromDateString}T00:00:00.000Z`).getTime();
  const to = new Date(`${toDateString_}T00:00:00.000Z`).getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

function classifyMembership(membership) {
  const today = todayInTimezone();
  const endDate = toDateString(membership && membership.endDate);
  const startDate = toDateString(membership && membership.startDate);
  let remainingDays = null;
  if (endDate) {
    remainingDays = daysBetween(today, endDate);
  }

  let state = "none";
  if (membership) {
    if (membership.status === "pending") {
      state = "pending";
    } else if (membership.status === "cancelled") {
      state = "cancelled";
    } else if (membership.status === "expired" || (remainingDays != null && remainingDays < 0)) {
      state = "expired";
    } else if (remainingDays != null && remainingDays <= EXPIRING_SOON_DAYS) {
      state = "expiring_soon";
    } else {
      state = "active";
    }
  }

  return {
    state,
    remainingDays,
    startDate,
    endDate,
    isActive: state === "active" || state === "expiring_soon"
  };
}

function maskNationalId(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  if (raw.length <= 4) {
    return "*".repeat(raw.length);
  }
  const visibleStart = raw.slice(0, 2);
  const visibleEnd = raw.slice(-2);
  return `${visibleStart}${"*".repeat(Math.max(raw.length - 4, 3))}${visibleEnd}`;
}

function publicProfile(profile, { revealNationalId = false } = {}) {
  return {
    id: profile.id,
    fullName: profile.fullName,
    email: profile.email,
    phone: profile.phone,
    memberCode: profile.memberCode,
    status: profile.status,
    registeredAt: profile.registeredAt,
    gender: profile.gender,
    birthDate: toDateString(profile.birthDate),
    nationality: profile.nationality,
    address: profile.address,
    city: profile.city,
    country: profile.country,
    nationalId: revealNationalId ? profile.nationalId || null : undefined,
    nationalIdMasked: maskNationalId(profile.nationalId),
    hasNationalId: Boolean(profile.nationalId),
    hasAvatar: Boolean(profile.hasAvatar),
    emergencyContact: profile.emergencyContact
  };
}

async function getMembershipView(userId) {
  const membership = await memberPortalRepository.getMembershipDetail(userId);
  const classification = classifyMembership(membership);
  return {
    membership: membership
      ? {
          id: membership.id,
          status: membership.status,
          plan: membership.plan,
          startDate: classification.startDate,
          endDate: classification.endDate
        }
      : null,
    state: classification.state,
    remainingDays: classification.remainingDays,
    isActive: classification.isActive
  };
}

async function getDashboard(userId) {
  const [profile, membershipView, payments, recentNotifications, unreadCount] = await Promise.all([
    memberPortalRepository.getProfile(userId),
    getMembershipView(userId),
    memberPortalRepository.getPayments(userId, { page: 1, pageSize: 5 }),
    notificationRepository.recentForUser(userId, 4),
    notificationRepository.unreadCount(userId)
  ]);

  return {
    member: {
      id: profile.id,
      fullName: profile.fullName,
      memberCode: profile.memberCode,
      email: profile.email,
      phone: profile.phone,
      registeredAt: profile.registeredAt,
      hasAvatar: Boolean(profile.hasAvatar)
    },
    membership: membershipView.membership,
    membershipState: membershipView.state,
    remainingDays: membershipView.remainingDays,
    isActive: membershipView.isActive,
    recentPayments: payments.items,
    recentNotifications,
    unreadCount
  };
}

async function getProfileView(userId, options = {}) {
  const profile = await memberPortalRepository.getProfile(userId);
  return publicProfile(profile, options);
}

async function getCard(userId) {
  const profile = await memberPortalRepository.getProfile(userId);
  const membershipView = await getMembershipView(userId);
  if (!profile.cardToken) {
    throw createHttpError(409, "Membership card is not ready yet.", "CARD_NOT_READY");
  }

  const verifyUrl = `${env.baseUrl.replace(/\/$/, "")}/card.html?t=${encodeURIComponent(profile.cardToken)}`;
  let qrDataUrl = null;
  try {
    qrDataUrl = await QRCode.toDataURL(verifyUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 260,
      color: { dark: "#0b0b0b", light: "#ffffff" }
    });
  } catch (error) {
    appLogger.error({ error }, "Failed to render membership card QR");
  }

  return {
    memberName: profile.fullName,
    memberCode: profile.memberCode,
    membership: membershipView.membership
      ? { plan: membershipView.membership.plan, endDate: membershipView.membership.endDate }
      : null,
    state: membershipView.state,
    remainingDays: membershipView.remainingDays,
    verifyUrl,
    qrDataUrl
  };
}

async function getPublicCard(token) {
  const card = await memberPortalRepository.getCardByToken(String(token || "").trim());
  if (!card) {
    return null;
  }
  const classification = classifyMembership(
    card.membership ? { status: card.membership.status, endDate: card.membership.endDate } : null
  );
  return {
    memberName: card.fullName,
    memberCode: card.memberCode,
    plan: card.membership ? card.membership.plan : null,
    state: classification.state,
    remainingDays: classification.remainingDays,
    endDate: classification.endDate,
    valid: classification.isActive && card.accountStatus === "active"
  };
}

module.exports = {
  classifyMembership,
  getCard,
  getDashboard,
  getMembershipView,
  getProfileView,
  getPublicCard,
  maskNationalId,
  publicProfile
};
