const customerRepository = require("../repositories/customerRepository");
const { createHttpError } = require("../utils/httpError");
const { createLog } = require("../utils/logger");
const {
  assertEmail,
  assertEnum,
  assertSaudiPhone,
  cleanEmail,
  cleanPhone,
  cleanString,
  pagination,
  requireFields
} = require("../utils/validator");

function normalizePayload(body) {
  return {
    ...body,
    fullName: cleanString(body.fullName, 160),
    email: body.email ? cleanEmail(body.email) : "",
    phone: body.phone ? cleanPhone(body.phone) : "",
    nationalId: cleanString(body.nationalId, 80),
    passportNumber: cleanString(body.passportNumber, 80),
    residencyNumber: cleanString(body.residencyNumber, 80),
    nationality: cleanString(body.nationality, 80),
    gender: cleanString(body.gender || "unspecified", 20),
    city: cleanString(body.city, 120),
    country: cleanString(body.country, 120)
  };
}

async function list(req, res) {
  // branchId is server-derived (req.effectiveBranchId, set by
  // attachEffectiveBranch) rather than taken from the query string -- a
  // client-supplied ?branchId= was previously honored as-is with no auth
  // check at all, letting any admin view another branch's customers. See
  // src/security/branchAccess.js for how effectiveBranchId is resolved.
  const data = await customerRepository.listCustomers({
    ...pagination(req.query),
    search: cleanString(req.query.search, 120),
    status: cleanString(req.query.status, 20),
    branchId: req.effectiveBranchId || "",
    gender: cleanString(req.query.gender, 20),
    nationality: cleanString(req.query.nationality, 80),
    membershipStatus: cleanString(req.query.membershipStatus, 20)
  });
  res.json({ success: true, data });
}

async function detail(req, res) {
  const data = await customerRepository.getCustomer(req.params.id);
  if (!data) {
    throw createHttpError(404, "Customer not found.", "CUSTOMER_NOT_FOUND");
  }
  res.json({ success: true, data });
}

async function create(req, res) {
  requireFields(req.body, ["fullName", "email", "phone"]);
  assertEmail(req.body.email);
  assertSaudiPhone(req.body.phone);
  if (req.body.gender) {
    assertEnum(cleanString(req.body.gender, 20), ["male", "female", "other", "unspecified"], "Gender");
  }
  if (req.body.status) {
    assertEnum(cleanString(req.body.status, 20), ["active", "inactive", "suspended"], "Customer status");
  }
  const data = await customerRepository.createCustomer(normalizePayload(req.body), req.user?.id);
  await createLog("admin", req.user?.id, "customer.create", "users", data.id, null, req.ip);
  res.status(201).json({ success: true, data });
}

async function update(req, res) {
  if (req.body.email) {
    assertEmail(req.body.email);
  }
  if (req.body.phone) {
    assertSaudiPhone(req.body.phone);
  }
  if (req.body.gender) {
    assertEnum(cleanString(req.body.gender, 20), ["male", "female", "other", "unspecified"], "Gender");
  }
  if (req.body.status) {
    assertEnum(cleanString(req.body.status, 20), ["active", "inactive", "suspended"], "Customer status");
  }
  const data = await customerRepository.updateCustomer(req.params.id, normalizePayload(req.body), req.user?.id);
  await createLog("admin", req.user?.id, "customer.update", "users", req.params.id, null, req.ip);
  res.json({ success: true, data });
}

module.exports = {
  create,
  detail,
  list,
  update
};
