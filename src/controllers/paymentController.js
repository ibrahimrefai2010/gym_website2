const paymentService = require("../services/paymentService");
const paymentRepository = require("../repositories/paymentRepository");
const userRepository = require("../repositories/userRepository");
const { assertBranchOwnership } = require("../security/branchAccess");
const { createHttpError } = require("../utils/httpError");

function requestOrigin(req) {
  return `${req.protocol}://${req.get("host")}`;
}

// Member starts (or resumes) an online checkout for one of their own
// branch's plans. Plan/branch validation and everything else happens in
// paymentService.startMoyasarCheckout -- the plan id is the only client input.
async function createCheckout(req, res) {
  if (req.user?.type !== "user") {
    throw createHttpError(403, "Only members can start a checkout.", "CHECKOUT_MEMBERS_ONLY");
  }
  if (!req.body?.planId) {
    throw createHttpError(422, "Choose a plan first.", "PLAN_REQUIRED");
  }
  if (req.body.provider === "stripe") {
    throw createHttpError(410, "This payment method is no longer available.", "PROVIDER_RETIRED");
  }
  const data = await paymentService.startMoyasarCheckout({
    userId: req.user.id,
    planId: req.body.planId,
    origin: requestOrigin(req)
  });
  res.status(201).json({ success: true, data });
}

// Kept for older clients; same as /checkout.
const createIntent = createCheckout;

async function webhook(req, res) {
  const provider = req.params.provider || "moyasar";
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  if (provider === "moyasar") {
    const data = await paymentService.handleMoyasarWebhook(rawBody);
    return res.json({ success: true, data });
  }
  const data = await paymentService.verifyWebhook(provider, {
    rawBody,
    signature: req.get("stripe-signature") || ""
  });
  return res.json({ success: true, data });
}

async function status(req, res) {
  const data = await paymentService.memberPaymentStatus(req.user.id, req.params.id);
  res.json({ success: true, data });
}

async function complete(req, res) {
  const owner = await paymentRepository.getPaymentOwnerBranch(req.params.id);
  await assertBranchOwnership(owner, req, createHttpError(404, "Payment not found.", "PAYMENT_NOT_FOUND"));

  const data = await paymentService.completePayment(req.user.id, req.params.id, {
    ipAddress: req.ip
  });
  res.json({ success: true, data });
}

async function history(req, res) {
  const dashboard = await userRepository.getDashboard(req.user.id);
  res.json({ success: true, data: dashboard.payments || [] });
}

module.exports = {
  complete,
  createCheckout,
  createIntent,
  history,
  status,
  webhook
};
