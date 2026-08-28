const paymentService = require("../services/paymentService");
const publicRepository = require("../repositories/publicRepository");
const userRepository = require("../repositories/userRepository");
const { createHttpError } = require("../utils/httpError");

async function createCheckout(req, res) {
  const [publicData, user] = await Promise.all([
    publicRepository.getBootstrap(),
    userRepository.findById(req.user.id)
  ]);

  const plan = publicData.plans.find((item) => String(item.id) === String(req.body.planId));
  if (!plan) {
    throw createHttpError(404, "Plan not found.", "PLAN_NOT_FOUND");
  }

  const result = await paymentService.createCheckoutSession({
    user,
    plan,
    provider: req.body.provider || "stripe"
  });

  res.json({ success: true, data: result });
}

async function createIntent(req, res) {
  const [publicData, user] = await Promise.all([
    publicRepository.getBootstrap(),
    userRepository.findById(req.user.id)
  ]);
  const plan = publicData.plans.find((item) => String(item.id) === String(req.body.planId));
  if (!plan) {
    throw createHttpError(404, "Plan not found.", "PLAN_NOT_FOUND");
  }

  const data = await paymentService.createIntent({
    user,
    plan,
    provider: req.body.provider || "stripe"
  });
  res.status(201).json({ success: true, data });
}

async function webhook(req, res) {
  const data = await paymentService.verifyWebhook(req.params.provider || req.body?.provider || "stripe", {
    rawBody: Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {})),
    signature: req.get("stripe-signature") || ""
  });
  res.json({ success: true, data });
}

async function complete(req, res) {
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
  webhook
};
