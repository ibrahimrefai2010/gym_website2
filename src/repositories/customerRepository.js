const crypto = require("crypto");
const { hasDatabaseConfig, query, transaction } = require("../config/database");
const { createHttpError } = require("../utils/httpError");
const { hashPassword } = require("../utils/hash");
const { positiveInteger } = require("../utils/validator");

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

function profilePayload(payload) {
  return {
    nationalId: payload.nationalId || null,
    passportNumber: payload.passportNumber || null,
    residencyNumber: payload.residencyNumber || null,
    nationality: payload.nationality || "",
    gender: payload.gender || "unspecified",
    birthDate: payload.birthDate || null,
    occupation: payload.occupation || "",
    company: payload.company || "",
    address: payload.address || "",
    city: payload.city || "",
    country: payload.country || "",
    heightCm: payload.heightCm || null,
    weightKg: payload.weightKg || null,
    bodyFatPercent: payload.bodyFatPercent || null,
    goals: payload.goals || null,
    trainerNotes: payload.trainerNotes || null,
    tags: payload.tags ? JSON.stringify(payload.tags) : null,
    metadata: payload.metadata ? JSON.stringify(payload.metadata) : null
  };
}

function mapCustomer(row) {
  return {
    id: row.id,
    branchId: row.branch_id,
    branchName: row.branch_name || "",
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    memberCode: row.member_code || null,
    status: row.status,
    gender: row.gender || "unspecified",
    nationality: row.nationality || "",
    birthDate: row.birth_date,
    city: row.city || "",
    membershipStatus: row.membership_status || "none",
    membershipPlan: row.membership_plan || "None",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Display status for the admin member list, in priority order:
// suspended account > frozen (active freeze today) > active > expired >
// pending > none. "frozen" is not a memberships.status value -- a freeze is a
// membership_freezes row (see membershipRepository.freezeMembership).
const MEMBER_LIST_STATUS_SQL = `CASE
    WHEN u.status = 'suspended' THEN 'suspended'
    WHEN fz.id IS NOT NULL THEN 'frozen'
    WHEN lm.status = 'active' AND (lm.end_date IS NULL OR lm.end_date >= UTC_DATE()) THEN 'active'
    WHEN lm.status IN ('active','expired') THEN 'expired'
    WHEN lm.status = 'pending' THEN 'pending'
    ELSE 'none'
  END`;

const MEMBER_LIST_SORTS = {
  newest: "u.created_at DESC",
  name: "u.full_name ASC",
  expiry: "lm.end_date IS NULL, lm.end_date ASC",
  lastVisit: "last_visit IS NULL, last_visit ASC"
};

// Admin member list. branchId is REQUIRED (server-derived); without one the
// list is empty rather than every branch.
async function listCustomers({
  page = 1,
  pageSize = 25,
  search = "",
  status = "",
  branchId = "",
  gender = "",
  nationality = "",
  membershipStatus = "",
  planId = "",
  coachId = "",
  expiringWithin = "",
  inactiveDays = "",
  sort = "newest"
} = {}) {
  ensureDatabase();
  const where = ["u.deleted_at IS NULL", "u.branch_id = ?"];
  const params = [branchId || 0];
  if (search) {
    where.push(`(
      u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR u.member_code = ?
      OR cp.national_id LIKE ? OR cp.passport_number LIKE ? OR cp.residency_number LIKE ?
    )`);
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, search, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    where.push("u.status = ?");
    params.push(status);
  }
  if (gender) {
    where.push("cp.gender = ?");
    params.push(gender);
  }
  if (nationality) {
    where.push("cp.nationality = ?");
    params.push(nationality);
  }
  if (["active", "expired", "frozen", "pending", "none", "suspended"].includes(membershipStatus)) {
    where.push(`${MEMBER_LIST_STATUS_SQL} = ?`);
    params.push(membershipStatus);
  }
  if (planId) {
    where.push("lm.plan_id = ?");
    params.push(planId);
  }
  if (coachId) {
    where.push("cp.coach_id = ?");
    params.push(coachId);
  }
  const expiring = Number.parseInt(expiringWithin, 10);
  if (Number.isInteger(expiring) && expiring > 0 && expiring <= 365) {
    where.push("lm.status = 'active' AND lm.end_date BETWEEN UTC_DATE() AND UTC_DATE() + INTERVAL ? DAY");
    params.push(expiring);
  }
  const inactive = Number.parseInt(inactiveDays, 10);
  if (Number.isInteger(inactive) && inactive > 0 && inactive <= 365) {
    // At-risk: an active membership but no visit in the window.
    where.push(`lm.status = 'active' AND lm.end_date >= UTC_DATE() AND fz.id IS NULL
      AND (la.last_visit IS NULL OR la.last_visit < UTC_TIMESTAMP() - INTERVAL ? DAY)`);
    params.push(inactive);
  }

  const limit = positiveInteger(pageSize, 25, 100);
  const currentPage = positiveInteger(page, 1, 1000000);
  const offset = (currentPage - 1) * limit;
  const baseJoin = `FROM users u
    LEFT JOIN customer_profiles cp ON cp.user_id = u.id AND cp.deleted_at IS NULL
    LEFT JOIN branches b ON b.id = u.branch_id
    LEFT JOIN coaches co ON co.id = cp.coach_id AND co.deleted_at IS NULL
    LEFT JOIN (
      SELECT ranked.id, ranked.user_id, ranked.status, ranked.start_date, ranked.end_date, ranked.plan_id
      FROM (
        SELECT mm.id, mm.user_id, mm.status, mm.start_date, mm.end_date, mm.plan_id,
          ROW_NUMBER() OVER (
            PARTITION BY mm.user_id
            ORDER BY FIELD(mm.status, 'active', 'pending', 'expired', 'cancelled'), COALESCE(mm.end_date, mm.created_at) DESC, mm.id DESC
          ) AS rn
        FROM memberships mm
        WHERE mm.status <> 'cancelled'
      ) ranked
      WHERE ranked.rn = 1
    ) lm ON lm.user_id = u.id
    LEFT JOIN plans p ON p.id = lm.plan_id
    LEFT JOIN membership_freezes fz ON fz.membership_id = lm.id AND fz.status = 'active' AND fz.deleted_at IS NULL
      AND UTC_DATE() BETWEEN fz.starts_on AND fz.ends_on
    LEFT JOIN (
      SELECT user_id, MAX(check_in_at) AS last_visit FROM attendance_logs WHERE deleted_at IS NULL GROUP BY user_id
    ) la ON la.user_id = u.id`;
  const order = MEMBER_LIST_SORTS[sort] || MEMBER_LIST_SORTS.newest;
  const rows = await query(
    `SELECT u.id, u.branch_id, b.name_en AS branch_name, u.full_name, u.email, u.phone, u.member_code,
      u.status, u.created_at, u.updated_at, cp.gender, cp.nationality, cp.birth_date, cp.city,
      cp.avatar_path, cp.coach_id, co.name_en AS coach_en, co.name_ar AS coach_ar,
      lm.id AS membership_id, lm.start_date, lm.end_date, p.name_en AS membership_plan, p.name_ar AS membership_plan_ar,
      ${MEMBER_LIST_STATUS_SQL} AS display_status,
      DATEDIFF(lm.end_date, UTC_DATE()) AS days_remaining,
      fz.ends_on AS frozen_until,
      la.last_visit
     ${baseJoin}
     WHERE ${where.join(" AND ")}
     ORDER BY ${order}, u.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const totalRows = await query(`SELECT COUNT(DISTINCT u.id) AS total ${baseJoin} WHERE ${where.join(" AND ")}`, params);
  return {
    items: rows.map((row) => ({
      ...mapCustomer({ ...row, membership_status: row.display_status }),
      membershipId: row.membership_id || null,
      membershipPlanAr: row.membership_plan_ar || null,
      startDate: row.start_date,
      endDate: row.end_date,
      daysRemaining: row.days_remaining == null ? null : Number(row.days_remaining),
      frozenUntil: row.frozen_until || null,
      lastVisit: row.last_visit || null,
      hasAvatar: Boolean(row.avatar_path),
      coach: row.coach_id ? { id: row.coach_id, name: { en: row.coach_en, ar: row.coach_ar } } : null
    })),
    pagination: { page: currentPage, pageSize: limit, total: Number(totalRows[0]?.total || 0) }
  };
}

async function createCustomer(payload, adminId = null) {
  ensureDatabase();
  const password = payload.password || crypto.randomBytes(18).toString("base64url");
  const profile = profilePayload(payload);
  try {
    return await transaction(async (connection) => {
      const [userResult] = await connection.execute(
        `INSERT INTO users (branch_id, full_name, email, phone, password_hash, status, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payload.branchId || 1,
          payload.fullName,
          payload.email,
          payload.phone,
          await hashPassword(password),
          payload.status || "active",
          adminId,
          adminId
        ]
      );
      const userId = userResult.insertId;
      // Member code + QR card token, same as self-registration
      // (userRepository.createUser) -- admin-created members had neither.
      await connection.execute(
        `UPDATE users SET member_code = CONCAT('MFC-', LPAD(id, 6, '0')), card_token = REPLACE(UUID(), '-', '')
         WHERE id = ? AND member_code IS NULL`,
        [userId]
      );
      await connection.execute(
        `INSERT INTO customer_profiles
          (user_id, branch_id, national_id, passport_number, residency_number, nationality, gender,
           birth_date, occupation, company, address, city, country, height_cm, weight_kg,
           body_fat_percent, goals, trainer_notes, tags, metadata, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          payload.branchId || 1,
          profile.nationalId,
          profile.passportNumber,
          profile.residencyNumber,
          profile.nationality,
          profile.gender,
          profile.birthDate,
          profile.occupation,
          profile.company,
          profile.address,
          profile.city,
          profile.country,
          profile.heightCm,
          profile.weightKg,
          profile.bodyFatPercent,
          profile.goals,
          profile.trainerNotes,
          profile.tags,
          profile.metadata,
          adminId,
          adminId
        ]
      );
      return { id: userId, temporaryPassword: payload.password ? null : password };
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      throw createHttpError(409, "A customer with this email or phone already exists.", "CUSTOMER_EXISTS");
    }
    throw error;
  }
}

async function updateCustomer(userId, payload, adminId = null) {
  ensureDatabase();
  // branch_id is deliberately NOT taken from payload -- see
  // customerController.update, which already rejects a by-id request for a
  // customer outside the caller's branch before this even runs. Letting a
  // client-supplied branchId field move an already-owned customer to a
  // *different* branch here would reopen that same hole from the write
  // side (spoofed branch in the body silently taking effect), so this
  // endpoint can never reassign a customer's branch -- that isn't a
  // supported admin action.
  const existing = await query("SELECT id, branch_id FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1", [userId]);
  if (!existing[0]) {
    throw createHttpError(404, "Customer not found.", "CUSTOMER_NOT_FOUND");
  }
  const branchId = existing[0].branch_id;

  const profile = profilePayload(payload);
  await transaction(async (connection) => {
    await connection.execute(
      `UPDATE users
       SET full_name = COALESCE(?, full_name),
         email = COALESCE(?, email), phone = COALESCE(?, phone),
         status = COALESCE(?, status), updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ? AND deleted_at IS NULL`,
      [
        payload.fullName || null,
        payload.email || null,
        payload.phone || null,
        payload.status || null,
        adminId,
        userId
      ]
    );
    await connection.execute(
      `INSERT INTO customer_profiles
        (user_id, branch_id, national_id, passport_number, residency_number, nationality, gender,
         birth_date, occupation, company, address, city, country, height_cm, weight_kg,
         body_fat_percent, goals, trainer_notes, tags, metadata, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         national_id = VALUES(national_id),
         passport_number = VALUES(passport_number),
         residency_number = VALUES(residency_number),
         nationality = VALUES(nationality),
         gender = VALUES(gender),
         birth_date = VALUES(birth_date),
         occupation = VALUES(occupation),
         company = VALUES(company),
         address = VALUES(address),
         city = VALUES(city),
         country = VALUES(country),
         height_cm = VALUES(height_cm),
         weight_kg = VALUES(weight_kg),
         body_fat_percent = VALUES(body_fat_percent),
         goals = VALUES(goals),
         trainer_notes = VALUES(trainer_notes),
         tags = VALUES(tags),
         metadata = VALUES(metadata),
         updated_by = VALUES(updated_by),
         updated_at = UTC_TIMESTAMP()`,
      [
        userId,
        branchId,
        profile.nationalId,
        profile.passportNumber,
        profile.residencyNumber,
        profile.nationality,
        profile.gender,
        profile.birthDate,
        profile.occupation,
        profile.company,
        profile.address,
        profile.city,
        profile.country,
        profile.heightCm,
        profile.weightKg,
        profile.bodyFatPercent,
        profile.goals,
        profile.trainerNotes,
        profile.tags,
        profile.metadata,
        adminId,
        adminId
      ]
    );
  });
  return getCustomer(userId);
}

async function getCustomer(userId) {
  ensureDatabase();
  const [users, memberships, invoices, payments, attendance, emergencyContacts, medicalRecords, notes, documents] =
    await Promise.all([
      query(
        // NOT `cp.*` -- users and customer_profiles both have id/branch_id/
        // created_by/updated_by/deleted_at/created_at/updated_at columns, so
        // a trailing `cp.*` silently overwrites u.*'s values with
        // customer_profiles' (an unmatched LEFT JOIN row is NULL, so a
        // customer with no profile row yet -- e.g. anyone who only ever
        // self-registered and was never touched by the admin CRM -- came
        // back with id/branch_id/created_at/updated_at all NULL). Select
        // only the customer_profiles columns actually needed below, none of
        // which collide with a users column.
        `SELECT u.*, b.name_en AS branch_name,
          cp.national_id, cp.passport_number, cp.residency_number, cp.nationality, cp.gender,
          cp.birth_date, cp.occupation, cp.company, cp.address, cp.city, cp.country,
          cp.height_cm, cp.weight_kg, cp.body_fat_percent, cp.goals, cp.trainer_notes, cp.tags,
          cp.metadata, cp.avatar_path
         FROM users u
         LEFT JOIN branches b ON b.id = u.branch_id
         LEFT JOIN customer_profiles cp ON cp.user_id = u.id AND cp.deleted_at IS NULL
         WHERE u.id = ? AND u.deleted_at IS NULL
         LIMIT 1`,
        [userId]
      ),
      query(
        `SELECT m.id, m.status, m.start_date, m.end_date, p.name_en AS plan_name
         FROM memberships m
         JOIN plans p ON p.id = m.plan_id
         WHERE m.user_id = ?
         ORDER BY COALESCE(m.end_date, m.created_at) DESC
         LIMIT 20`,
        [userId]
      ),
      query("SELECT id, invoice_number, status, total, balance_due, issue_date FROM invoices WHERE user_id = ? AND deleted_at IS NULL ORDER BY issue_date DESC LIMIT 20", [userId]),
      query("SELECT id, amount, currency, status, payment_method, created_at, completed_at FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 20", [userId]),
      query("SELECT id, check_in_at, check_out_at, method, status FROM attendance_logs WHERE user_id = ? AND deleted_at IS NULL ORDER BY check_in_at DESC LIMIT 20", [userId]),
      query("SELECT id, name, phone, relationship, is_primary FROM emergency_contacts WHERE user_id = ? AND deleted_at IS NULL ORDER BY is_primary DESC, id DESC", [userId]),
      query("SELECT id, record_type, title, details, recorded_at FROM medical_records WHERE user_id = ? AND deleted_at IS NULL ORDER BY recorded_at DESC LIMIT 20", [userId]),
      query("SELECT id, note, visibility, created_at FROM customer_notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20", [userId]),
      query("SELECT id, category, original_name, mime_type, file_size, status, created_at FROM documents WHERE owner_type = 'customer' AND owner_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20", [userId])
    ]);

  const row = users[0];
  if (!row) {
    return null;
  }
  return {
    customer: {
      ...mapCustomer({
        id: row.user_id || row.id,
        branch_id: row.branch_id,
        branch_name: row.branch_name,
        full_name: row.full_name,
        email: row.email,
        phone: row.phone,
        status: row.status,
        gender: row.gender,
        nationality: row.nationality,
        birth_date: row.birth_date,
        city: row.city,
        created_at: row.created_at,
        updated_at: row.updated_at
      }),
      memberCode: row.member_code || null,
      hasAvatar: Boolean(row.avatar_path)
    },
    profile: {
      nationalId: row.national_id,
      passportNumber: row.passport_number,
      residencyNumber: row.residency_number,
      occupation: row.occupation,
      company: row.company,
      address: row.address,
      country: row.country,
      heightCm: row.height_cm,
      weightKg: row.weight_kg,
      bodyFatPercent: row.body_fat_percent,
      goals: row.goals,
      trainerNotes: row.trainer_notes,
      tags: row.tags
    },
    memberships,
    invoices,
    payments,
    attendance,
    emergencyContacts,
    medicalRecords,
    notes,
    documents
  };
}

// ---- Admin member actions --------------------------------------------------

async function addNote(userId, note, adminId) {
  ensureDatabase();
  const text = String(note || "").trim().slice(0, 4000);
  if (!text) {
    throw createHttpError(422, "Write a note first.", "NOTE_REQUIRED");
  }
  const result = await query(
    "INSERT INTO customer_notes (user_id, note, visibility, created_by, updated_by) VALUES (?, ?, 'internal', ?, ?)",
    [userId, text, adminId, adminId]
  );
  return { id: result.insertId, note: text };
}

async function listNotes(userId) {
  ensureDatabase();
  return query(
    `SELECT n.id, n.note, n.created_at, a.full_name AS author
     FROM customer_notes n
     LEFT JOIN admin_users a ON a.id = n.created_by
     WHERE n.user_id = ? AND n.deleted_at IS NULL
     ORDER BY n.created_at DESC, n.id DESC
     LIMIT 100`,
    [userId]
  );
}

// Soft delete: the account can no longer sign in or check in, but every
// financial and attendance record stays intact. Active sessions are revoked.
async function softDeleteCustomer(userId, adminId) {
  ensureDatabase();
  return transaction(async (connection) => {
    const [result] = await connection.execute(
      "UPDATE users SET deleted_at = UTC_TIMESTAMP(), status = 'inactive', updated_at = UTC_TIMESTAMP() WHERE id = ? AND deleted_at IS NULL",
      [userId]
    );
    if (result.affectedRows === 0) {
      throw createHttpError(404, "Customer not found.", "CUSTOMER_NOT_FOUND");
    }
    await connection.execute("UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL", [userId]);
    await connection.execute(
      "INSERT INTO customer_notes (user_id, note, visibility, created_by, updated_by) VALUES (?, 'Account deleted (soft delete).', 'internal', ?, ?)",
      [userId, adminId, adminId]
    );
    return { id: Number(userId), deleted: true };
  });
}

// New card token: any printed/screenshotted QR stops working immediately.
async function regenerateCardToken(userId) {
  ensureDatabase();
  await query("UPDATE users SET card_token = REPLACE(UUID(), '-', ''), updated_at = UTC_TIMESTAMP() WHERE id = ? AND deleted_at IS NULL", [userId]);
  const rows = await query("SELECT card_token FROM users WHERE id = ?", [userId]);
  return { id: Number(userId), cardToken: rows[0]?.card_token || null };
}

// At-risk members of one branch: active (not frozen) membership, no visit
// in `inactivityDays` (never visited counts once they have had the
// membership that long). Used by the daily task job and the dashboard.
async function listAtRiskMembers(branchId, inactivityDays, limit = 500) {
  ensureDatabase();
  const days = Math.max(1, Math.min(Number(inactivityDays) || 14, 365));
  return query(
    `SELECT u.id, u.full_name AS fullName, u.member_code AS memberCode, la.last_visit AS lastVisit
     FROM users u
     JOIN memberships m ON m.user_id = u.id AND m.status = 'active' AND m.end_date >= UTC_DATE()
     LEFT JOIN membership_freezes fz ON fz.membership_id = m.id AND fz.status = 'active' AND fz.deleted_at IS NULL
       AND UTC_DATE() BETWEEN fz.starts_on AND fz.ends_on
     LEFT JOIN (SELECT user_id, MAX(check_in_at) AS last_visit FROM attendance_logs WHERE deleted_at IS NULL GROUP BY user_id) la
       ON la.user_id = u.id
     WHERE u.branch_id = ? AND u.deleted_at IS NULL AND u.status = 'active' AND fz.id IS NULL
       AND (
         (la.last_visit IS NOT NULL AND la.last_visit < UTC_TIMESTAMP() - INTERVAL ? DAY)
         OR (la.last_visit IS NULL AND m.start_date <= UTC_DATE() - INTERVAL ? DAY)
       )
     GROUP BY u.id, u.full_name, u.member_code, la.last_visit
     LIMIT ${Math.max(1, Math.min(Number(limit) || 500, 5000))}`,
    [branchId, days, days]
  );
}

module.exports = {
  listAtRiskMembers,
  addNote,
  listNotes,
  regenerateCardToken,
  softDeleteCustomer,
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer
};
