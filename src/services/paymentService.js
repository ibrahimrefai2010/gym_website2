const { env } = require("../config/env");
const { createHttpError } = require("../utils/httpError");
const paymentRepository = require("../repositories/paymentRepository");
const membershipRepository = require("../repositories/membershipRepository");
const { createLog } = require("../utils/logger");

let stripeClient;

function getStripe() {
  if (!env.stripeSecretKey) {
    return null;
  }

  if (!stripeClient) {
    const Stripe = require("stripe");
    stripeClient = new Stripe(env.stripeSecretKey);
  }

  return stripeClient;
}

async function createStripeCheckoutSession({ user, plan, membershipId = null }) {
  const stripe = getStripe();

  if (!stripe) {
    return {
      mode: "prepared",
      checkoutUrl: null,
      message: "Stripe is ready for production keys.",
      context: {
        userId: user.id,
        planId: plan?.id || null,
        membershipId
      }
    };
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: user.email,
    line_items: [
      {
        price_data: {
          currency: "sar",
          product_data: {
            name: plan.name?.en || "Gym membership"
          },
          unit_amount: Math.round(Number(plan.price) * 100)
        },
        quantity: 1
      }
    ],
    metadata: {
      userId: String(user.id),
      planId: String(plan.id),
      membershipId: membershipId ? String(membershipId) : ""
    },
    success_url: env.paymentSuccessUrl,
    cancel_url: env.paymentCancelUrl
  });

  return {
    mode: "live",
    checkoutUrl: session.url,
    sessionId: session.id
  };
}

async function createCheckoutSession({ user, plan, provider = "stripe", membershipId = null }) {
  if (provider !== "stripe") {
    return { mode: "prepared", provider, message: `${provider} adapter is ready for credentials.` };
  }
  return createStripeCheckoutSession({ user, plan, membershipId });
}

async function createIntent(options) {
  return createCheckoutSession(options);
}

async function verifyWebhook(provider, options = {}) {
  if ((provider || "stripe") !== "stripe") {
    return { verified: false, provider, message: "Webhook adapter is not configured yet." };
  }

  const stripe = getStripe();
  if (!stripe || !env.stripeWebhookSecret) {
    return {
      verified: false,
      provider: "stripe",
      message: "Stripe webhook verification is ready after configuring secrets."
    };
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(options.rawBody, options.signature, env.stripeWebhookSecret);
  } catch (_error) {
    throw createHttpError(400, "Payment verification failed.", "STRIPE_SIGNATURE_INVALID");
  }

  if (await paymentRepository.hasProcessedEvent("stripe", event.id)) {
    return { verified: true, duplicate: true, eventId: event.id };
  }

  await paymentRepository.recordEvent({
    provider: "stripe",
    eventId: event.id,
    eventType: event.type,
    payload: options.rawBody.toString("utf8")
  });

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const payment = await paymentRepository.createPayment({
      userId: session.metadata?.userId,
      membershipId: session.metadata?.membershipId || null,
      provider: "stripe",
      paymentMethod: "stripe",
      providerReference: session.id,
      transactionId: session.payment_intent || session.id,
      amount: Number(session.amount_total || 0) / 100,
      currency: String(session.currency || "SAR").toUpperCase(),
      status: "completed",
      completedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
      rawPayload: session
    });
    if (session.metadata?.userId) {
      await createLog("user", session.metadata.userId, "payment.create", "payments", payment.id, { provider: "stripe" }, null);
      await createLog("user", session.metadata.userId, "payment.complete", "payments", payment.id, { provider: "stripe" }, null);
    }
    if (session.metadata?.membershipId) {
      await membershipRepository.maybeAutoActivate(session.metadata.membershipId, null);
    }
    return { verified: true, eventId: event.id, eventType: event.type, payment };
  }

  return { verified: true, eventId: event.id, eventType: event.type };
}

async function completePayment(adminId, paymentId, context = {}) {
  const data = await paymentRepository.completePayment(paymentId, adminId);
  await createLog("admin", adminId, "payment.complete", "payments", paymentId, data, context.ipAddress);
  if (data.activation?.id) {
    await createLog("admin", adminId, "membership.activate", "memberships", data.activation.id, { source: "payment.complete" }, context.ipAddress);
  }
  return data;
}

module.exports = {
  completePayment,
  createCheckoutSession,
  createIntent,
  verifyWebhook
};
