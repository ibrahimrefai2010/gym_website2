const { hasDatabaseConfig, query } = require("../config/database");
const { createHttpError } = require("../utils/httpError");
const { positiveInteger } = require("../utils/validator");

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

const GENDERS = ["male", "female", "other", "unspecified"];

function planLocale(row, prefix = "plan") {
  return { en: row[`${prefix}_name_en`] || "", ar: row[`${prefix}_name_ar`] || "" };
}

async function getProfile(userId) {
  ensureDatabase();
  const [userRows, profileRows, contactRows] = await Promise.all([
    query(
      `SELECT id, full_name, email, phone, member_code, card_token, status, created_at
       FROM users
       WHERE id = ? AND deleted_at IS NULL
       LIMIT 1`,
      [userId]
    ),
    query(
      `SELECT national_id, gender, birth_date, nationality, address, city, country, avatar_path
       FROM customer_profiles
       WHERE user_id = ? AND deleted_at IS NULL
       LIMIT 1`,
      [userId]
    ),
    query(
      `SELECT id, name, phone, relationship
       FROM emergency_contacts
       WHERE user_id = ? AND deleted_at IS NULL
       ORDER BY is_primary DESC, id ASC
       LIMIT 1`,
      [userId]
    )
  ]);

  const user = userRows[0];
  if (!user) {
    throw createHttpError(404, "Account not found.", "USER_NOT_FOUND");
  }
  const profile = profileRows[0] || {};
  const contact = contactRows[0] || null;

  return {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    phone: user.phone,
    memberCode: user.member_code,
    cardToken: user.card_token,
    status: user.status,
    registeredAt: user.created_at,
    nationalId: profile.national_id || null,
    gender: profile.gender || "unspecified",
    birthDate: profile.birth_date || null,
    nationality: profile.nationality || "",
    address: profile.address || "",
    city: profile.city || "",
    country: profile.country || "",
    avatarPath: profile.avatar_path || null,
    hasAvatar: Boolean(profile.avatar_path),
    emergencyContact: contact
      ? { id: contact.id, name: contact.name, phone: contact.phone, relationship: contact.relationship || "" }
      : null
  };
}

async function updatePersonalInfo(userId, payload) {
  ensureDatabase();

  if (payload.fullName !== undefined || payload.phone !== undefined) {
    const result = await query(
      `UPDATE users
       SET full_name = COALESCE(?, full_name),
           phone = COALESCE(?, phone),
           updated_at = UTC_TIMESTAMP()
       WHERE id = ? AND deleted_at IS NULL`,
      [payload.fullName ?? null, payload.phone ?? null, userId]
    );
    if (result.affectedRows === 0) {
      throw createHttpError(404, "Account not found.", "USER_NOT_FOUND");
    }
  }

  const gender = GENDERS.includes(payload.gender) ? payload.gender : null;
  const hasProfileFields =
    payload.nationalId !== undefined ||
    gender !== null ||
    payload.birthDate !== undefined ||
    payload.nationality !== undefined ||
    payload.address !== undefined ||
    payload.city !== undefined ||
    payload.country !== undefined;

  if (hasProfileFields) {
    await query(
      `INSERT INTO customer_profiles
         (user_id, national_id, gender, birth_date, nationality, address, city, country)
       VALUES (?, ?, COALESCE(?, 'unspecified'), ?, COALESCE(?, ''), COALESCE(?, ''), COALESCE(?, ''), COALESCE(?, ''))
       ON DUPLICATE KEY UPDATE
         national_id = COALESCE(VALUES(national_id), national_id),
         gender = COALESCE(VALUES(gender), gender),
         birth_date = COALESCE(VALUES(birth_date), birth_date),
         nationality = COALESCE(NULLIF(VALUES(nationality), ''), nationality),
         address = COALESCE(NULLIF(VALUES(address), ''), address),
         city = COALESCE(NULLIF(VALUES(city), ''), city),
         country = COALESCE(NULLIF(VALUES(country), ''), country),
         updated_at = UTC_TIMESTAMP()`,
      [
        userId,
        payload.nationalId ?? null,
        gender,
        payload.birthDate ?? null,
        payload.nationality ?? null,
        payload.address ?? null,
        payload.city ?? null,
        payload.country ?? null
      ]
    );
  }

  return getProfile(userId);
}

async function upsertEmergencyContact(userId, payload) {
  ensureDatabase();
  const name = String(payload.name || "").trim();
  const phone = String(payload.phone || "").trim();
  const relationship = String(payload.relationship || "").trim().slice(0, 80);

  const existing = await query(
    `SELECT id FROM emergency_contacts
     WHERE user_id = ? AND deleted_at IS NULL
     ORDER BY is_primary DESC, id ASC
     LIMIT 1`,
    [userId]
  );

  if (!name && !phone && existing[0]) {
    await query("UPDATE emergency_contacts SET deleted_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ?", [
      existing[0].id,
      userId
    ]);
    return getProfile(userId);
  }

  if (!name || !phone) {
    throw createHttpError(422, "Emergency contact name and phone are required.", "EMERGENCY_CONTACT_INCOMPLETE");
  }

  if (existing[0]) {
    await query(
      `UPDATE emergency_contacts
       SET name = ?, phone = ?, relationship = ?, is_primary = 1, updated_at = UTC_TIMESTAMP()
       WHERE id = ? AND user_id = ?`,
      [name, phone, relationship, existing[0].id, userId]
    );
  } else {
    await query(
      `INSERT INTO emergency_contacts (user_id, name, phone, relationship, is_primary)
       VALUES (?, ?, ?, ?, 1)`,
      [userId, name, phone, relationship]
    );
  }

  return getProfile(userId);
}

async function getAvatarPath(userId) {
  ensureDatabase();
  const rows = await query(
    "SELECT avatar_path FROM customer_profiles WHERE user_id = ? AND deleted_at IS NULL LIMIT 1",
    [userId]
  );
  return rows[0]?.avatar_path || null;
}

async function setAvatarPath(userId, storedName) {
  ensureDatabase();
  await query(
    `INSERT INTO customer_profiles (user_id, avatar_path)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE avatar_path = VALUES(avatar_path), updated_at = UTC_TIMESTAMP()`,
    [userId, storedName]
  );
}

async function getMembershipDetail(userId) {
  ensureDatabase();
  const rows = await query(
    `SELECT m.id, m.status, m.start_date, m.end_date, m.created_at,
            p.id AS plan_id, p.name_en AS plan_name_en, p.name_ar AS plan_name_ar,
            p.price AS plan_price, p.duration_days, p.bonus_days
     FROM memberships m
     JOIN plans p ON p.id = m.plan_id
     WHERE m.user_id = ?
     ORDER BY COALESCE(m.end_date, m.created_at) DESC, m.id DESC
     LIMIT 1`,
    [userId]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
    plan: {
      id: row.plan_id,
      name: planLocale(row),
      price: Number(row.plan_price || 0),
      durationDays: Number(row.duration_days || 0),
      bonusDays: Number(row.bonus_days || 0)
    }
  };
}

async function getMembershipHistory(userId) {
  ensureDatabase();
  const rows = await query(
    `SELECT m.id, m.status, m.start_date, m.end_date, m.created_at, m.cancelled_at,
            p.name_en AS plan_name_en, p.name_ar AS plan_name_ar, p.price AS plan_price
     FROM memberships m
     JOIN plans p ON p.id = m.plan_id
     WHERE m.user_id = ?
     ORDER BY COALESCE(m.start_date, m.created_at) DESC, m.id DESC
     LIMIT 50`,
    [userId]
  );
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
    cancelledAt: row.cancelled_at,
    plan: { name: planLocale(row), price: Number(row.plan_price || 0) }
  }));
}

async function getMemberSince(userId) {
  ensureDatabase();
  const rows = await query("SELECT created_at FROM users WHERE id = ? LIMIT 1", [userId]);
  return rows[0]?.created_at || null;
}

async function getPayments(userId, { page = 1, pageSize = 20 } = {}) {
  ensureDatabase();
  const limit = positiveInteger(pageSize, 20, 50);
  const currentPage = positiveInteger(page, 1, 100000);
  const offset = (currentPage - 1) * limit;

  const rows = await query(
    `SELECT pay.id, pay.amount, pay.currency, pay.status, pay.provider, pay.payment_method,
            pay.transaction_id, pay.provider_reference, pay.invoice_id,
            pay.completed_at, pay.created_at,
            p.name_en AS plan_name_en, p.name_ar AS plan_name_ar
     FROM payments pay
     LEFT JOIN memberships m ON m.id = pay.membership_id
     LEFT JOIN plans p ON p.id = m.plan_id
     WHERE pay.user_id = ?
     ORDER BY pay.created_at DESC, pay.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    [userId]
  );
  const totalRows = await query("SELECT COUNT(*) AS total FROM payments WHERE user_id = ?", [userId]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      amount: Number(row.amount || 0),
      currency: row.currency || "SAR",
      status: row.status,
      provider: row.provider,
      paymentMethod: row.payment_method,
      reference: row.transaction_id || row.provider_reference || null,
      hasReceipt: Boolean(row.invoice_id) || row.status === "completed",
      plan: row.plan_name_en || row.plan_name_ar ? planLocale(row) : null,
      date: row.completed_at || row.created_at,
      createdAt: row.created_at
    })),
    pagination: {
      page: currentPage,
      pageSize: limit,
      total: Number(totalRows[0]?.total || 0)
    }
  };
}

async function getPaymentReceipt(userId, paymentId) {
  ensureDatabase();
  const rows = await query(
    `SELECT pay.id, pay.amount, pay.currency, pay.status, pay.provider, pay.payment_method,
            pay.transaction_id, pay.provider_reference, pay.invoice_id,
            pay.completed_at, pay.created_at,
            p.name_en AS plan_name_en, p.name_ar AS plan_name_ar
     FROM payments pay
     LEFT JOIN memberships m ON m.id = pay.membership_id
     LEFT JOIN plans p ON p.id = m.plan_id
     WHERE pay.id = ? AND pay.user_id = ?
     LIMIT 1`,
    [paymentId, userId]
  );
  const payment = rows[0];
  if (!payment) {
    throw createHttpError(404, "Payment not found.", "PAYMENT_NOT_FOUND");
  }

  let invoice = null;
  if (payment.invoice_id) {
    const invoiceRows = await query(
      `SELECT id, invoice_number, status, issue_date, due_date, subtotal, discount_total,
              tax_total, total, paid_total, balance_due, currency, notes
       FROM invoices
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL
       LIMIT 1`,
      [payment.invoice_id, userId]
    );
    if (invoiceRows[0]) {
      const items = await query(
        `SELECT description, quantity, unit_price, discount, tax_amount, line_total
         FROM invoice_items
         WHERE invoice_id = ? AND deleted_at IS NULL
         ORDER BY id ASC`,
        [invoiceRows[0].id]
      );
      invoice = {
        number: invoiceRows[0].invoice_number,
        status: invoiceRows[0].status,
        issueDate: invoiceRows[0].issue_date,
        dueDate: invoiceRows[0].due_date,
        currency: invoiceRows[0].currency,
        subtotal: Number(invoiceRows[0].subtotal || 0),
        discountTotal: Number(invoiceRows[0].discount_total || 0),
        taxTotal: Number(invoiceRows[0].tax_total || 0),
        total: Number(invoiceRows[0].total || 0),
        paidTotal: Number(invoiceRows[0].paid_total || 0),
        balanceDue: Number(invoiceRows[0].balance_due || 0),
        notes: invoiceRows[0].notes || "",
        items: items.map((item) => ({
          description: item.description,
          quantity: Number(item.quantity || 0),
          unitPrice: Number(item.unit_price || 0),
          discount: Number(item.discount || 0),
          taxAmount: Number(item.tax_amount || 0),
          lineTotal: Number(item.line_total || 0)
        }))
      };
    }
  }

  return {
    payment: {
      id: payment.id,
      amount: Number(payment.amount || 0),
      currency: payment.currency || "SAR",
      status: payment.status,
      provider: payment.provider,
      paymentMethod: payment.payment_method,
      reference: payment.transaction_id || payment.provider_reference || null,
      plan: payment.plan_name_en || payment.plan_name_ar ? planLocale(payment) : null,
      date: payment.completed_at || payment.created_at,
      createdAt: payment.created_at
    },
    invoice
  };
}

async function getCardByToken(token) {
  ensureDatabase();
  const rows = await query(
    `SELECT u.full_name, u.member_code, u.status AS account_status
     FROM users u
     WHERE u.card_token = ? AND u.deleted_at IS NULL
     LIMIT 1`,
    [token]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  const membership = await query(
    `SELECT m.status, m.end_date, p.name_en AS plan_name_en, p.name_ar AS plan_name_ar
     FROM memberships m
     JOIN plans p ON p.id = m.plan_id
     JOIN users u ON u.id = m.user_id
     WHERE u.card_token = ?
     ORDER BY COALESCE(m.end_date, m.created_at) DESC, m.id DESC
     LIMIT 1`,
    [token]
  );

  return {
    fullName: row.full_name,
    memberCode: row.member_code,
    accountStatus: row.account_status,
    membership: membership[0]
      ? {
          status: membership[0].status,
          endDate: membership[0].end_date,
          plan: planLocale(membership[0])
        }
      : null
  };
}

module.exports = {
  getAvatarPath,
  getCardByToken,
  getMemberSince,
  setAvatarPath,
  getMembershipDetail,
  getMembershipHistory,
  getPaymentReceipt,
  getPayments,
  getProfile,
  updatePersonalInfo,
  upsertEmergencyContact
};
