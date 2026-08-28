const membershipRepository = require("../repositories/membershipRepository");
const { createLog } = require("../utils/logger");

async function buy(userId, payload, context = {}) {
  const data = await membershipRepository.buy({
    userId,
    planId: payload.planId,
    paymentMethod: payload.paymentMethod || "manual",
    provider: payload.provider || "manual"
  });
  await createLog("user", userId, "membership.buy", "memberships", data.membership.id, { paymentId: data.payment.id }, context.ipAddress);
  await createLog("user", userId, "payment.create", "payments", data.payment.id, { membershipId: data.membership.id }, context.ipAddress);
  return data;
}

async function activate(adminId, membershipId, context = {}) {
  const data = await membershipRepository.activateMembership(membershipId, adminId);
  await createLog("admin", adminId, "membership.activate", "memberships", membershipId, null, context.ipAddress);
  return data;
}

async function cancel(adminId, membershipId, context = {}) {
  const data = await membershipRepository.updateMembership(membershipId, "cancel");
  await createLog("admin", adminId, "membership.cancel", "memberships", membershipId, null, context.ipAddress);
  return data;
}

module.exports = {
  activate,
  buy,
  cancel
};
