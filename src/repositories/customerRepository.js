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

async function listCustomers({ page = 1, pageSize = 25, search = "", status = "", branchId = "", gender = "", nationality = "", membershipStatus = "" } = {}) {
  ensureDatabase();
  const where = ["u.deleted_at IS NULL"];
  const params = [];
  if (search) {
    where.push(`(
      u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?
      OR cp.national_id LIKE ? OR cp.passport_number LIKE ? OR cp.residency_number LIKE ?
    )`);
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    where.push("u.status = ?");
    params.push(status);
  }
  if (branchId) {
    where.push("u.branch_id = ?");
    params.push(branchId);
  }
  if (gender) {
    where.push("cp.gender = ?");
    params.push(gender);
  }
  if (nationality) {
    where.push("cp.nationality = ?");
    params.push(nationality);
  }
  if (membershipStatus) {
    where.push("m.status = ?");
    params.push(membershipStatus);
  }

  const limit = positiveInteger(pageSize, 25, 100);
  const currentPage = positiveInteger(page, 1, 1000000);
  const offset = (currentPage - 1) * limit;
  const baseJoin = `FROM users u
    LEFT JOIN customer_profiles cp ON cp.user_id = u.id AND cp.deleted_at IS NULL
    LEFT JOIN branches b ON b.id = u.branch_id
    LEFT JOIN memberships m ON m.user_id = u.id AND m.status = 'active'
    LEFT JOIN plans p ON p.id = m.plan_id`;
  const rows = await query(
    `SELECT u.id, u.branch_id, b.name_en AS branch_name, u.full_name, u.email, u.phone,
      u.status, u.created_at, u.updated_at, cp.gender, cp.nationality, cp.birth_date,
      cp.city, m.status AS membership_status, p.name_en AS membership_plan
     ${baseJoin}
     WHERE ${where.join(" AND ")}
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const totalRows = await query(`SELECT COUNT(DISTINCT u.id) AS total ${baseJoin} WHERE ${where.join(" AND ")}`, params);
  return {
    items: rows.map(mapCustomer),
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
  const existing = await query("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1", [userId]);
  if (!existing[0]) {
    throw createHttpError(404, "Customer not found.", "CUSTOMER_NOT_FOUND");
  }

  const profile = profilePayload(payload);
  await transaction(async (connection) => {
    await connection.execute(
      `UPDATE users
       SET branch_id = COALESCE(?, branch_id), full_name = COALESCE(?, full_name),
         email = COALESCE(?, email), phone = COALESCE(?, phone),
         status = COALESCE(?, status), updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ? AND deleted_at IS NULL`,
      [
        payload.branchId || null,
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
       VALUES (?, COALESCE(?, 1), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         branch_id = COALESCE(VALUES(branch_id), branch_id),
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
        payload.branchId || null,
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
        `SELECT u.*, b.name_en AS branch_name, cp.*
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
    customer: mapCustomer({
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

module.exports = {
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer
};
