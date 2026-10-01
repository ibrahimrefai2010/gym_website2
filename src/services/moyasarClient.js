// Thin client for the Moyasar REST API (https://docs.moyasar.com).
//
//  - Base URL https://api.moyasar.com/v1, HTTP Basic auth with the SECRET key
//    as username and an empty password.
//  - Amounts are integers in the smallest currency unit (halalas for SAR,
//    minimum 100).
//  - We use Moyasar *invoices* (hosted checkout page): POST /invoices returns
//    { id, status, url, ... } and the member is redirected to `url`, so no
//    card data ever touches this server (stays out of PCI scope).
//
// MOYASAR_API_BASE is only overridden in tests (a local mock server); it is
// never needed in production.

const { env } = require("../config/env");
const { createHttpError } = require("../utils/httpError");

function isConfigured() {
  return Boolean(env.moyasarSecretKey);
}

function toHalalas(amount) {
  return Math.round(Number(amount) * 100);
}

function fromHalalas(amount) {
  return Number(amount || 0) / 100;
}

async function call(method, path, body) {
  if (!isConfigured()) {
    throw createHttpError(503, "Online payments are not configured yet.", "MOYASAR_NOT_CONFIGURED");
  }
  const auth = Buffer.from(`${env.moyasarSecretKey}:`).toString("base64");
  let response;
  try {
    response = await fetch(`${env.moyasarApiBase.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000)
    });
  } catch (_error) {
    throw createHttpError(502, "The payment provider could not be reached. Please try again.", "MOYASAR_UNREACHABLE");
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Never echo provider error bodies to the member; keep the type/message
    // for the server log via the error's details.
    const error = createHttpError(502, "The payment provider rejected the request.", "MOYASAR_ERROR");
    error.details = { status: response.status, type: payload.type, message: payload.message };
    throw error;
  }
  return payload;
}

async function createInvoice({ amount, currency = "SAR", description, successUrl, backUrl, callbackUrl, expiredAt, metadata }) {
  return call("POST", "/invoices", {
    amount: toHalalas(amount),
    currency,
    description,
    success_url: successUrl,
    back_url: backUrl,
    callback_url: callbackUrl,
    expired_at: expiredAt,
    metadata
  });
}

async function fetchInvoice(id) {
  return call("GET", `/invoices/${encodeURIComponent(id)}`);
}

async function fetchPayment(id) {
  return call("GET", `/payments/${encodeURIComponent(id)}`);
}

module.exports = {
  createInvoice,
  fetchInvoice,
  fetchPayment,
  fromHalalas,
  isConfigured,
  toHalalas
};
