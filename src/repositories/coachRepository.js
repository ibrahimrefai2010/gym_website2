// Part 2 (feature/women-branch, continued): Coaches.
//
// `coaches` + `customer_profiles.coach_id` were created by
// 202609090001_admin_core.up.sql but never wired to any repository/
// controller/route -- see 202609180004_coaches_branch.up.sql for the
// branch_id backfill this table needed before it could join the rest of
// this app's branch-scoping story. Mirrors planRepository/customerRepository
// for shape and conventions (branch-required saves, soft delete via
// is_active/deleted_at -- both already existed on this table).

const { hasDatabaseConfig, query } = require("../config/database");
const { createHttpError } = require("../utils/httpError");
const { cleanString } = require("../utils/validator");

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

function mapCoach(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    branchId: row.branch_id != null ? Number(row.branch_id) : null,
    adminUserId: row.admin_user_id != null ? Number(row.admin_user_id) : null,
    name: { en: row.name_en, ar: row.name_ar },
    specialty: { en: row.specialty_en || "", ar: row.specialty_ar || "" },
    bio: { en: row.bio_en || "", ar: row.bio_ar || "" },
    certifications: { en: row.certifications_en || "", ar: row.certifications_ar || "" },
    yearsExperience: Number(row.years_experience || 0),
    photoUrl: row.photo_url || null,
    isActive: Boolean(row.is_active),
    displayOrder: Number(row.display_order || 0),
    assignedMemberCount: row.assigned_member_count != null ? Number(row.assigned_member_count) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const COACH_SELECT = `SELECT c.*,
    (SELECT COUNT(*) FROM customer_profiles cp WHERE cp.coach_id = c.id) AS assigned_member_count
   FROM coaches c`;

// branchId is required for a real list, same "empty means no rows"
// convention as taskRepository.listTasks/customerRepository -- callers
// always pass req.effectiveBranchId, never trust a client-supplied value.
async function listCoaches({ branchId = "", includeInactive = false } = {}) {
  ensureDatabase();
  const where = ["c.deleted_at IS NULL"];
  const params = [];

  if (branchId) {
    where.push("c.branch_id = ?");
    params.push(branchId);
  } else {
    where.push("1 = 0");
  }
  if (!includeInactive) {
    where.push("c.is_active = 1");
  }

  const rows = await query(
    `${COACH_SELECT}
     WHERE ${where.join(" AND ")}
     ORDER BY c.display_order ASC, c.id ASC`,
    params
  );
  return rows.map(mapCoach);
}

async function getCoach(id) {
  ensureDatabase();
  const rows = await query(`${COACH_SELECT} WHERE c.id = ? AND c.deleted_at IS NULL LIMIT 1`, [id]);
  return mapCoach(rows[0]);
}

async function saveCoach(payload, adminId = null) {
  ensureDatabase();
  const nameEn = cleanString(payload.nameEn, 160);
  const nameAr = cleanString(payload.nameAr, 160);
  if (!nameEn || !nameAr) {
    throw createHttpError(422, "Coach name is required in both languages.", "COACH_NAME_REQUIRED");
  }

  const branchId = Number(payload.branchId);
  if (!Number.isInteger(branchId) || branchId < 1) {
    throw createHttpError(422, "Coach branchId is required.", "COACH_BRANCH_REQUIRED");
  }

  const specialtyEn = cleanString(payload.specialtyEn, 200);
  const specialtyAr = cleanString(payload.specialtyAr, 200);
  const bioEn = payload.bioEn !== undefined ? cleanString(payload.bioEn, 4000) : "";
  const bioAr = payload.bioAr !== undefined ? cleanString(payload.bioAr, 4000) : "";
  const certificationsEn = payload.certificationsEn !== undefined ? cleanString(payload.certificationsEn, 2000) : "";
  const certificationsAr = payload.certificationsAr !== undefined ? cleanString(payload.certificationsAr, 2000) : "";
  const yearsExperience = Math.max(0, Math.min(99, Number.parseInt(payload.yearsExperience, 10) || 0));
  const photoUrl = payload.photoUrl ? cleanString(payload.photoUrl, 255) : null;
  const isActive = payload.isActive !== false;
  const displayOrder = Number.isFinite(Number(payload.displayOrder)) ? Number(payload.displayOrder) : 0;
  const adminUserId = payload.adminUserId ? Number(payload.adminUserId) : null;

  if (payload.id) {
    const result = await query(
      `UPDATE coaches
       SET branch_id = ?, admin_user_id = ?, name_en = ?, name_ar = ?, specialty_en = ?, specialty_ar = ?,
         bio_en = ?, bio_ar = ?, certifications_en = ?, certifications_ar = ?, years_experience = ?,
         photo_url = ?, is_active = ?, display_order = ?, updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ? AND deleted_at IS NULL`,
      [
        branchId,
        adminUserId,
        nameEn,
        nameAr,
        specialtyEn,
        specialtyAr,
        bioEn,
        bioAr,
        certificationsEn,
        certificationsAr,
        yearsExperience,
        photoUrl,
        isActive,
        displayOrder,
        adminId,
        payload.id
      ]
    );
    if (result.affectedRows === 0) {
      throw createHttpError(404, "Coach not found.", "COACH_NOT_FOUND");
    }
    return getCoach(payload.id);
  }

  const result = await query(
    `INSERT INTO coaches
      (branch_id, admin_user_id, name_en, name_ar, specialty_en, specialty_ar, bio_en, bio_ar,
       certifications_en, certifications_ar, years_experience, photo_url, is_active, display_order,
       created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      branchId,
      adminUserId,
      nameEn,
      nameAr,
      specialtyEn,
      specialtyAr,
      bioEn,
      bioAr,
      certificationsEn,
      certificationsAr,
      yearsExperience,
      photoUrl,
      isActive,
      displayOrder,
      adminId,
      adminId
    ]
  );
  return getCoach(result.insertId);
}

// Soft delete: is_active = false + deleted_at, same convention as
// planRepository.deletePlan. Never hard-deletes -- a coach can be linked
// from customer_profiles.coach_id (ON DELETE SET NULL) and from historical
// records, so keeping the row (just hidden) avoids silently orphaning that
// history.
async function deleteCoach(id, adminId = null) {
  ensureDatabase();
  const result = await query(
    `UPDATE coaches
     SET is_active = 0, deleted_at = UTC_TIMESTAMP(), updated_by = ?, updated_at = UTC_TIMESTAMP()
     WHERE id = ? AND deleted_at IS NULL`,
    [adminId, id]
  );
  if (result.affectedRows === 0) {
    throw createHttpError(404, "Coach not found.", "COACH_NOT_FOUND");
  }
  return { id: Number(id), deleted: true };
}

// Member -> coach assignment. Both the coach and the member must belong to
// the SAME branch -- exactly the kind of cross-branch mistake Part 1's
// enforcement work (assertBranchOwnership, branch-scoped uniqueness, etc.)
// exists to prevent. The controller already checks the coach's ownership via
// assertBranchOwnership before calling this; this function independently
// re-verifies both sides itself (defense in depth -- a repository function
// callable from anywhere, e.g. a future kiosk/import path, should not rely
// on a caller having remembered to check first).
async function assignMember(coachId, userId, adminId = null) {
  ensureDatabase();
  const [coachRows, userRows] = await Promise.all([
    query("SELECT id, branch_id FROM coaches WHERE id = ? AND deleted_at IS NULL LIMIT 1", [coachId]),
    query("SELECT id, branch_id FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1", [userId])
  ]);
  const coach = coachRows[0];
  const user = userRows[0];
  if (!coach) {
    throw createHttpError(404, "Coach not found.", "COACH_NOT_FOUND");
  }
  if (!user) {
    throw createHttpError(404, "Member not found.", "CUSTOMER_NOT_FOUND");
  }
  if (Number(coach.branch_id) !== Number(user.branch_id)) {
    // Same 404 as a missing member: a member of another branch must not be
    // distinguishable from one that does not exist.
    throw createHttpError(404, "Member not found.", "CUSTOMER_NOT_FOUND");
  }

  const result = await query(
    "UPDATE customer_profiles SET coach_id = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE user_id = ?",
    [coachId, adminId, userId]
  );
  if (result.affectedRows === 0) {
    // The member has no customer_profiles row yet (e.g. never touched by
    // the admin CRM) -- create a minimal one rather than silently no-oping,
    // same "insert the profile row on demand" idea customerRepository's own
    // ON DUPLICATE KEY UPDATE path relies on for an existing row.
    await query(
      "INSERT INTO customer_profiles (user_id, branch_id, coach_id, created_by, updated_by) VALUES (?, ?, ?, ?, ?)",
      [userId, user.branch_id, coachId, adminId, adminId]
    );
  }
  return { userId: Number(userId), coachId: Number(coachId) };
}

// Unassign (coach_id -> NULL). Only needs the member's own branch check --
// there is no coach involved once cleared.
async function unassignMember(userId, adminId = null) {
  ensureDatabase();
  const result = await query(
    "UPDATE customer_profiles SET coach_id = NULL, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE user_id = ?",
    [adminId, userId]
  );
  return { userId: Number(userId), coachId: null, updated: result.affectedRows > 0 };
}

// For the by-id ownership check on member-facing routes that take a userId
// but no coachId (e.g. unassign) -- same { branchId } shape
// assertBranchOwnership expects.
async function getMemberBranch(userId) {
  ensureDatabase();
  const rows = await query("SELECT id, branch_id FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1", [userId]);
  if (!rows[0]) {
    return null;
  }
  return { id: rows[0].id, branchId: Number(rows[0].branch_id) };
}

// Members currently assigned to a coach (admin coach detail view).
async function listAssignedMembers(coachId) {
  ensureDatabase();
  return query(
    `SELECT u.id, u.full_name, u.member_code, u.phone
     FROM customer_profiles cp
     JOIN users u ON u.id = cp.user_id AND u.deleted_at IS NULL
     WHERE cp.coach_id = ?
     ORDER BY u.full_name ASC
     LIMIT 500`,
    [coachId]
  );
}

module.exports = {
  listAssignedMembers,
  assignMember,
  deleteCoach,
  getCoach,
  getMemberBranch,
  listCoaches,
  saveCoach,
  unassignMember
};
