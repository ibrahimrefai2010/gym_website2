const { env } = require("../config/env");
const { createHttpError } = require("../utils/httpError");
const paymentRepository = require("../repositories/paymentRepository");
const membershipRepository = require("../repositories/membershipRepository");
const crypto = require("crypto");
const { query, transaction } = require("../config/database");
const { createLog, appLogger } = require("../utils/logger");
const moyasar = require("./moyasarClient");
const taskService = require("./taskService");
const planRepository = require("../repositories/planRepository");
const userRepository = require("../repositories/userRepository");
const invoiceRepository = require("../repositories/invoiceRepository");
const businessSettingsRepository = require("../repositories/businessSettingsRepository");

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

// Stripe is retired (owner decision 2026-09-09); reachable only when
// provider "stripe" is requested explicitly. Moyasar is the default.
async function createCheckoutSession({ user, plan, provider = "moyasar", membershipId = null, origin }) {
  if (provider === "stripe") {
    return createStripeCheckoutSession({ user, plan, membershipId });
  }
  return startMoyasarCheckout({ userId: user.id, planId: plan.id, origin });
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


// ---------------------------------------------------------------------------
// Moyasar hosted checkout
// ---------------------------------------------------------------------------
//
// Lifecycle of one attempt (one `payments` row, provider 'moyasar'):
//   startMoyasarCheckout     pending row (+ pending membership for a first
//                            purchase) -> Moyasar invoice -> hosted page URL.
//   finalizeMoyasarPayment   the ONLY place that moves the row out of
//                            'pending'. Always re-fetches the invoice from
//                            Moyasar server-side; never trusts a redirect
//                            query string or a webhook body for amounts or
//                            status. Paid -> one transaction: payment
//                            completed + membership activated/extended +
//                            ZATCA invoice issued (gap-free number). Row lock
//                            + status check make it idempotent: duplicate
//                            webhooks, the redirect and the reconcile job can
//                            all race and only one completes it.
//   handleMoyasarWebhook     verifies secret_token, then calls the finalizer.
//   reconcileMoyasarPayments cron safety net for missed webhooks/abandons.

const MOYASAR_FAILED_STATUSES = ["failed"];
const MOYASAR_CLOSED_STATUSES = ["canceled", "cancelled", "expired", "voided"];

function sqlDateTime(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function allowedOrigins() {
  return String(env.corsOrigin || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

// Where Moyasar sends the member back. Must be the branch's own origin
// (session cookies are per-host), but the Host header is client input, so
// only an origin on the CORS allowlist is used; anything else falls back to
// BASE_URL.
function returnOrigin(requestOrigin) {
  const candidate = String(requestOrigin || "").replace(/\/$/, "");
  return allowedOrigins().includes(candidate) ? candidate : String(env.baseUrl).replace(/\/$/, "");
}

async function startMoyasarCheckout({ userId, planId, origin }) {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw createHttpError(404, "User not found.", "USER_NOT_FOUND");
  }
  const plan = await planRepository.getPlan(planId);
  // A plan from another branch is indistinguishable from a missing one.
  if (!plan || !plan.isActive || Number(plan.branchId) !== Number(user.branch_id)) {
    throw createHttpError(404, "Plan not found.", "PLAN_NOT_FOUND");
  }
  if (!moyasar.isConfigured()) {
    throw createHttpError(503, "Online payments are not configured yet. Please pay at reception.", "MOYASAR_NOT_CONFIGURED");
  }

  const reusable = await paymentRepository.findOpenCheckout(user.id, plan.id);
  if (reusable) {
    return { mode: "live", provider: "moyasar", paymentId: reusable.id, checkoutUrl: reusable.checkout_url, reused: true };
  }

  const active = await membershipRepository.activeMembership(user.id);
  const purpose = active ? "renewal" : "new";
  const { paymentId } = await paymentRepository.createCheckoutAttempt({
    userId: user.id,
    branchId: Number(user.branch_id),
    planId: plan.id,
    amount: plan.price,
    purpose,
    membershipId: active ? active.id : null
  });

  const back = `${returnOrigin(origin)}/user.html?payment=${paymentId}`;
  const expiresAt = new Date(Date.now() + env.moyasarInvoiceTtlMinutes * 60 * 1000);
  let invoice;
  try {
    invoice = await moyasar.createInvoice({
      amount: plan.price,
      currency: "SAR",
      description: `${env.appName} - ${plan.name.en} (${purpose === "renewal" ? "renewal" : "membership"}) #${paymentId}`,
      successUrl: back,
      backUrl: back,
      expiredAt: expiresAt.toISOString(),
      metadata: { payment_id: String(paymentId), user_id: String(user.id), branch_id: String(user.branch_id) }
    });
  } catch (error) {
    await paymentRepository.closeCheckoutAttempt(paymentId, "failed", "checkout_creation_failed");
    appLogger.error({ paymentId, code: error.code, details: error.details }, "moyasar.invoice_create_failed");
    await createLog("user", user.id, "payment.checkout_failed", "payments", paymentId, { provider: "moyasar", code: error.code }, null, user.branch_id);
    throw error;
  }

  await paymentRepository.setCheckoutDetails(paymentId, {
    reference: invoice.id,
    checkoutUrl: invoice.url,
    expiresAt: sqlDateTime(expiresAt)
  });
  await createLog("user", user.id, "payment.checkout_started", "payments", paymentId, { provider: "moyasar", purpose, planId: plan.id, amount: plan.price }, null, user.branch_id);
  return { mode: "live", provider: "moyasar", paymentId, checkoutUrl: invoice.url };
}

// Applies a paid attempt to the member's membership on the finalizer's
// connection. Handles the races where the member's state changed between
// checkout and payment (e.g. reception activated a membership meanwhile, or
// the membership being renewed lapsed) without ever dropping paid days.
async function applyPaidMembership(connection, payment, adminId = null) {
  const [activeRows] = await connection.execute(
    `SELECT id FROM memberships
     WHERE user_id = ? AND status = 'active' AND (end_date IS NULL OR end_date >= UTC_DATE())
     ORDER BY end_date DESC LIMIT 1 FOR UPDATE`,
    [payment.user_id]
  );
  const active = activeRows[0];

  if (payment.purpose === "renewal" && active) {
    return membershipRepository.extendOnConnection(connection, active.id, payment.plan_id);
  }
  if (payment.purpose === "new" && !active && payment.membership_id) {
    return membershipRepository.activateOnConnection(connection, payment.membership_id, adminId);
  }
  if (active) {
    // Bought "new" but became active meanwhile -> extend instead, and retire
    // the now-redundant pending membership.
    if (payment.membership_id && payment.membership_id !== active.id) {
      await connection.execute(
        "UPDATE memberships SET status = 'cancelled', cancelled_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'pending'",
        [payment.membership_id]
      );
    }
    const extended = await membershipRepository.extendOnConnection(connection, active.id, payment.plan_id);
    await connection.execute("UPDATE payments SET membership_id = ? WHERE id = ?", [active.id, payment.id]);
    return extended;
  }
  // Renewal whose membership lapsed meanwhile -> start a fresh membership.
  const [inserted] = await connection.execute(
    "INSERT INTO memberships (user_id, plan_id, branch_id, status) VALUES (?, ?, ?, 'pending')",
    [payment.user_id, payment.plan_id, payment.branch_id]
  );
  await connection.execute("UPDATE payments SET membership_id = ? WHERE id = ?", [inserted.insertId, payment.id]);
  return membershipRepository.activateOnConnection(connection, inserted.insertId, adminId);
}

async function buildPaymentInvoice(payment) {
  const plan = await planRepository.getPlan(payment.plan_id);
  const seller = await businessSettingsRepository.get(payment.branch_id);
  const vatRate = seller?.vatRate == null ? 15 : Number(seller.vatRate);
  const planLabel = plan ? `${plan.name.ar} / ${plan.name.en}` : `Plan #${payment.plan_id}`;
  return invoiceRepository.prepareInvoice({
    branchId: payment.branch_id,
    userId: payment.user_id,
    membershipId: payment.membership_id,
    status: "paid",
    paidTotal: Number(payment.amount),
    currency: payment.currency || "SAR",
    items: [
      {
        planId: payment.plan_id,
        itemType: "membership",
        description: `${payment.purpose === "renewal" ? "تجديد عضوية / Membership renewal" : "عضوية / Membership"} - ${planLabel}`,
        quantity: 1,
        unitPrice: Number(payment.amount),
        taxRate: vatRate,
        taxInclusive: true
      }
    ],
    metadata: { paymentId: payment.id, provider: payment.provider }
  });
}

async function closeAttempt(payment, status, reason, invoice, source) {
  if (await paymentRepository.closeCheckoutAttempt(payment.id, status, reason, invoice)) {
    await createLog("user", payment.user_id, `payment.${status}`, "payments", payment.id, { provider: "moyasar", reason, source }, null, payment.branch_id);
    if (status === "failed") {
      await notifyFailedPayment(payment, reason);
    }
  }
  return { id: payment.id, status, changed: true, reason };
}

function lastFailedAttempt(attempts) {
  return [...attempts].reverse().find((attempt) => String(attempt.status).toLowerCase() === "failed") || null;
}

async function finalizeMoyasarPayment(paymentId, { source = "unknown" } = {}) {
  const payment = await paymentRepository.getPayment(paymentId);
  if (!payment || payment.provider !== "moyasar") {
    throw createHttpError(404, "Payment not found.", "PAYMENT_NOT_FOUND");
  }
  if (payment.status !== "pending") {
    return { id: payment.id, status: payment.status, changed: false };
  }
  if (!payment.provider_reference) {
    // Checkout never reached Moyasar; close it once it is clearly abandoned.
    const ageMs = Date.now() - new Date(payment.created_at).getTime();
    if (ageMs > 60 * 60 * 1000) {
      return closeAttempt(payment, "cancelled", "checkout_not_created", null, source);
    }
    return { id: payment.id, status: "pending", changed: false };
  }

  const invoice = await moyasar.fetchInvoice(payment.provider_reference);
  const invoiceStatus = String(invoice.status || "").toLowerCase();
  const attempts = Array.isArray(invoice.payments) ? invoice.payments : [];
  const lastFailure = lastFailedAttempt(attempts);

  if (invoiceStatus === "paid") {
    const expectedHalalas = moyasar.toHalalas(payment.amount);
    if (
      Number(invoice.amount) !== expectedHalalas ||
      String(invoice.currency || "").toUpperCase() !== String(payment.currency || "SAR").toUpperCase()
    ) {
      // Paid, but not what we asked for -- never extend a membership on a
      // mismatched amount. Flag for a human.
      return closeAttempt(payment, "failed", "amount_mismatch", invoice, source);
    }
    const paidAttempt = attempts.find((attempt) => String(attempt.status).toLowerCase() === "paid") || null;
    return settlePaidPayment(payment, { transactionId: paidAttempt?.id || payment.provider_reference, rawPayload: invoice, source });
  }

  if (MOYASAR_FAILED_STATUSES.includes(invoiceStatus) || MOYASAR_CLOSED_STATUSES.includes(invoiceStatus)) {
    const failed = Boolean(lastFailure || payment.failure_reason) || MOYASAR_FAILED_STATUSES.includes(invoiceStatus);
    const reason = lastFailure?.source?.message || payment.failure_reason || invoiceStatus;
    return closeAttempt(payment, failed ? "failed" : "cancelled", reason, invoice, source);
  }

  // Still payable ('initiated'). Note any failed card attempt for the
  // member/admin view; close as abandoned once well past expiry.
  if (lastFailure) {
    await paymentRepository.noteAttemptFailure(payment.id, lastFailure.source?.message || "failed");
  }
  const expiredLocally = payment.expires_at && new Date(payment.expires_at).getTime() + 15 * 60 * 1000 < Date.now();
  if (expiredLocally) {
    const failed = Boolean(lastFailure || payment.failure_reason);
    const reason = lastFailure?.source?.message || payment.failure_reason || "abandoned";
    return closeAttempt(payment, failed ? "failed" : "cancelled", reason, invoice, source);
  }
  return {
    id: payment.id,
    status: "pending",
    changed: false,
    lastFailure: lastFailure?.source?.message || payment.failure_reason || null
  };
}

// Settles a paid attempt (Moyasar or manual/reception) in ONE transaction:
// payment completed + membership activated/extended + ZATCA invoice issued.
// Row lock + "still pending" check make it idempotent.
async function settlePaidPayment(payment, { transactionId = null, rawPayload = null, source = "unknown", adminId = null } = {}) {
  // Prepared outside the transaction (no number allocated yet). If the
  // branch's VAT identity isn't configured the invoice can't be issued --
  // the member still paid, so complete the payment + membership anyway and
  // raise a task for the missing invoice rather than leaving them locked out.
  let preparedInvoice = null;
  let invoiceError = null;
  try {
    preparedInvoice = await buildPaymentInvoice(payment);
  } catch (error) {
    invoiceError = error;
  }

  const result = await transaction(async (connection) => {
    const [rows] = await connection.execute("SELECT id, status FROM payments WHERE id = ? FOR UPDATE", [payment.id]);
    if (!rows[0] || rows[0].status !== "pending") {
      return { alreadyFinal: true, status: rows[0]?.status || "unknown" };
    }
    await connection.execute(
      `UPDATE payments
       SET status = 'completed', completed_at = UTC_TIMESTAMP(), completed_by = ?, transaction_id = COALESCE(?, transaction_id),
           failure_reason = NULL, checkout_url = NULL, raw_payload = COALESCE(?, raw_payload), updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [adminId, transactionId, rawPayload ? JSON.stringify(rawPayload) : null, payment.id]
    );
    const membership = await applyPaidMembership(connection, payment, adminId);
    let issued = null;
    if (preparedInvoice) {
      const [current] = await connection.execute("SELECT membership_id FROM payments WHERE id = ?", [payment.id]);
      preparedInvoice.payload.membershipId = current[0].membership_id;
      issued = await invoiceRepository.insertPreparedInvoice(connection, preparedInvoice, adminId);
      await connection.execute("UPDATE payments SET invoice_id = ? WHERE id = ?", [issued.id, payment.id]);
    }
    return { membership, invoice: issued };
  });

  if (result.alreadyFinal) {
    return { id: payment.id, status: result.status, changed: false };
  }

  const actorType = adminId ? "admin" : "user";
  const actorId = adminId || payment.user_id;
  await createLog(actorType, actorId, "payment.complete", "payments", payment.id, { provider: payment.provider, source, invoiceId: result.invoice?.id || null }, null, payment.branch_id);
  if (result.invoice) {
    await createLog(actorType, actorId, "invoice.create", "invoices", result.invoice.id, { invoiceNumber: result.invoice.invoiceNumber, paymentId: payment.id }, null, payment.branch_id);
  }
  const amountLabel = `${payment.currency || "SAR"} ${Number(payment.amount || 0).toFixed(2)}`;
  await createMemberNotification(
    payment.user_id,
    "payment_succeeded",
    "تم استلام دفعتك",
    "Payment received",
    `تم استلام دفعتك بمبلغ ${amountLabel} بنجاح.`,
    `We received your payment of ${amountLabel} successfully.`
  );

  if (invoiceError) {
    appLogger.error({ paymentId: payment.id, code: invoiceError.code }, "payment.invoice_not_issued");
    await taskService
      .createTaskForPaymentIssue(payment, `Invoice not issued for paid payment #${payment.id}: ${invoiceError.message}`)
      .catch(() => {});
  }
  return {
    id: payment.id,
    status: "completed",
    changed: true,
    membership: result.membership,
    invoice: result.invoice,
    invoiceError: invoiceError ? invoiceError.message : null
  };
}

const MANUAL_METHODS = ["cash", "card", "bank_transfer"];

// Reception records a payment taken in person (cash / card terminal / bank
// transfer). Same settle path as an online payment, so membership + invoice
// + payment always land together. `branchId` is the admin's server-derived
// effective branch: a member from another branch is a 404. idempotencyKey
// (client-generated per form submission) makes a double-submit return the
// first result instead of charging twice.
async function recordManualPayment(adminId, branchId, input = {}) {
  const method = String(input.method || "");
  if (!MANUAL_METHODS.includes(method)) {
    throw createHttpError(422, "Choose cash, card or bank transfer.", "PAYMENT_METHOD_INVALID");
  }
  const idempotencyKey = String(input.idempotencyKey || "").trim().slice(0, 100);
  if (!/^[\w-]{8,100}$/.test(idempotencyKey)) {
    throw createHttpError(422, "Missing submission key. Refresh and try again.", "IDEMPOTENCY_KEY_REQUIRED");
  }
  const existing = await paymentRepository.findByProviderReference("manual", `idem:${idempotencyKey}`);
  if (existing) {
    return { id: existing.id, status: existing.status, duplicate: true, invoiceId: existing.invoice_id };
  }

  const user = await userRepository.findById(input.userId);
  if (!user || Number(user.branch_id) !== Number(branchId)) {
    throw createHttpError(404, "Member not found.", "CUSTOMER_NOT_FOUND");
  }
  const plan = await planRepository.getPlan(input.planId);
  if (!plan || !plan.isActive || Number(plan.branchId) !== Number(branchId)) {
    throw createHttpError(404, "Plan not found.", "PLAN_NOT_FOUND");
  }

  const active = await membershipRepository.activeMembership(user.id);
  const purpose = active ? "renewal" : "new";
  const created = await paymentRepository.createManualAttempt({
    userId: user.id,
    branchId: Number(branchId),
    planId: plan.id,
    amount: plan.price,
    purpose,
    membershipId: active ? active.id : null,
    method,
    reference: `idem:${idempotencyKey}`,
    externalReference: String(input.reference || "").trim().slice(0, 190) || null,
    adminId
  });
  if (created.duplicate) {
    const again = await paymentRepository.getPayment(created.paymentId);
    return { id: again.id, status: again.status, duplicate: true, invoiceId: again.invoice_id };
  }
  const payment = await paymentRepository.getPayment(created.paymentId);
  const settled = await settlePaidPayment(payment, { transactionId: payment.transaction_id, source: "reception", adminId });
  return { ...settled, invoiceId: settled.invoice?.id || null, invoiceNumber: settled.invoice?.invoiceNumber || null, purpose };
}

async function createMemberNotification(userId, type, titleAr, titleEn, bodyAr, bodyEn) {
  await query(
    "INSERT INTO notifications (user_id, type, title_ar, title_en, body_ar, body_en) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, type, titleAr, titleEn, bodyAr, bodyEn]
  ).catch(() => {});
}

async function notifyFailedPayment(payment, reason) {
  await createMemberNotification(
    payment.user_id,
    "payment_failed",
    "لم تكتمل عملية الدفع",
    "Payment was not completed",
    "لم تكتمل عملية الدفع ولم تتغير عضويتك. يمكنك المحاولة مرة أخرى من حسابك.",
    "Your payment was not completed and your membership was not changed. You can try again from your account."
  );
  await taskService.createTaskForFailedPayment({ ...payment, failureReason: reason }, payment.branch_id).catch(() => {});
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

async function handleMoyasarWebhook(rawBody) {
  if (!env.moyasarWebhookSecret) {
    throw createHttpError(503, "Webhook is not configured.", "MOYASAR_WEBHOOK_NOT_CONFIGURED");
  }
  let event;
  try {
    event = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || ""));
  } catch (_error) {
    throw createHttpError(400, "Invalid webhook payload.", "MOYASAR_WEBHOOK_INVALID");
  }
  if (!safeEqual(event.secret_token, env.moyasarWebhookSecret)) {
    throw createHttpError(401, "Webhook verification failed.", "MOYASAR_WEBHOOK_UNAUTHORIZED");
  }
  // A test-mode event must never complete anything on a live deployment.
  if (env.moyasarMode === "live" && event.live === false) {
    return { verified: true, ignored: "test_event_on_live" };
  }
  const eventId = String(event.id || "");
  if (!eventId) {
    throw createHttpError(400, "Invalid webhook payload.", "MOYASAR_WEBHOOK_INVALID");
  }
  if (await paymentRepository.hasProcessedEvent("moyasar", eventId)) {
    return { verified: true, duplicate: true, eventId };
  }

  const data = event.data || {};
  const local = data.invoice_id ? await paymentRepository.findByProviderReference("moyasar", data.invoice_id) : null;

  let outcome = { ignored: "unknown_payment" };
  if (local && String(event.type || "").startsWith("payment_")) {
    // Status always comes from a fresh server-side fetch, not this payload.
    outcome = await finalizeMoyasarPayment(local.id, { source: `webhook:${event.type}` });
  }

  // Recorded only after successful processing: if the fetch above failed,
  // Moyasar's retry is processed again instead of being dropped as a dupe.
  // Concurrent duplicates are safe anyway (finalizer row lock).
  await paymentRepository.recordEvent({
    provider: "moyasar",
    eventId,
    eventType: String(event.type || "unknown").slice(0, 160),
    payload: JSON.stringify({ ...event, secret_token: "[redacted]" })
  });
  return { verified: true, eventId, eventType: event.type, ...outcome };
}

async function reconcileMoyasarPayments() {
  if (!moyasar.isConfigured()) {
    return { checked: 0, changed: 0 };
  }
  const pending = await paymentRepository.listPendingMoyasar(50);
  let changed = 0;
  for (const payment of pending) {
    try {
      const result = await finalizeMoyasarPayment(payment.id, { source: "reconcile" });
      if (result.changed) changed += 1;
    } catch (error) {
      appLogger.error({ paymentId: payment.id, code: error.code }, "moyasar.reconcile_failed");
    }
  }
  return { checked: pending.length, changed };
}

// Member-facing status check after the redirect back from Moyasar. Only the
// owner can see it (anything else is a 404). Pending attempts are finalized
// on the spot so the member sees the outcome immediately.
async function memberPaymentStatus(userId, paymentId) {
  let payment = await paymentRepository.getPayment(paymentId);
  if (!payment || Number(payment.user_id) !== Number(userId)) {
    throw createHttpError(404, "Payment not found.", "PAYMENT_NOT_FOUND");
  }
  if (payment.status === "pending" && payment.provider === "moyasar") {
    try {
      await finalizeMoyasarPayment(payment.id, { source: "return" });
    } catch (error) {
      appLogger.error({ paymentId: payment.id, code: error.code }, "moyasar.return_check_failed");
    }
    payment = await paymentRepository.getPayment(paymentId);
  }
  let invoiceNumber = null;
  if (payment.invoice_id) {
    const found = await invoiceRepository.getInvoice(payment.invoice_id);
    invoiceNumber = found?.invoice?.invoice_number || null;
  }
  return {
    id: payment.id,
    status: payment.status,
    purpose: payment.purpose,
    amount: Number(payment.amount),
    currency: payment.currency,
    planId: payment.plan_id,
    failureReason: payment.failure_reason,
    checkoutUrl: payment.status === "pending" ? payment.checkout_url : null,
    invoiceId: payment.invoice_id,
    invoiceNumber
  };
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
  MANUAL_METHODS,
  completePayment,
  recordManualPayment,
  settlePaidPayment,
  finalizeMoyasarPayment,
  handleMoyasarWebhook,
  memberPaymentStatus,
  reconcileMoyasarPayments,
  returnOrigin,
  startMoyasarCheckout,
  createCheckoutSession,
  createIntent,
  verifyWebhook
};
