// Part 2 (feature/women-branch, continued): Check-in reception mode.
//
// attendanceRepository.checkIn() previously inserted an attendance_logs row
// blindly for any userId, with no check that the member actually has an
// active membership -- see the brief's Feature 2 gap #1. verifyAndCheckIn is
// the single place that gap is closed: it looks up the member, decides
// active/not, and only then calls attendanceRepository.checkIn().
//
// Kept as ONE reusable, side-effect-isolated function specifically so a
// future physical access-control/kiosk integration (turnstile, door
// controller, etc.) can call it directly -- it takes a member identifier and
// a method, and returns a plain allow/deny result. No HTTP, no Express
// req/res anywhere in this file. That hardware integration itself is out of
// scope for this phase (see brief's Constraints) -- this is just the seam
// being kept clean for it.

const userRepository = require("../repositories/userRepository");
const membershipRepository = require("../repositories/membershipRepository");
const attendanceRepository = require("../repositories/attendanceRepository");
const { query, transaction } = require("../config/database");

// A second scan of the same member inside this window (re-scan, or a second
// desk scanning at the same moment) returns the existing visit instead of
// writing another attendance row.
const DUPLICATE_WINDOW_MINUTES = 5;

// Mirrors attendanceRepository's own ATTENDANCE_METHODS enum (method column
// on attendance_logs) -- not re-exported from there to avoid a circular/
// tangled dependency for one small array; kept in sync manually, same as
// that module's own inline copy of the DB enum.
const CHECKIN_METHODS = ["manual", "qr", "mobile", "kiosk", "import"];

// Card QR concept already exists (users.card_token, see
// memberPortalService.js's card verifyUrl / GET /api/v1/public/card/:token)
// -- this is the ONLY QR scheme this app has; reception reuses it rather
// than inventing a second one. A scanned code may be the raw 32-hex token,
// or the full verify URL (card.html?t=<token>) if the physical/rendered QR
// image is scanned as a link -- both encode the same token.
function extractCardToken(code) {
  const raw = String(code || "").trim();
  if (!raw) {
    return null;
  }
  const bare = /^[a-f0-9]{32}$/i;
  if (bare.test(raw)) {
    return raw.toLowerCase();
  }
  const match = raw.match(/[?&]t=([a-f0-9]{32})/i);
  return match ? match[1].toLowerCase() : null;
}

// Resolves a scanned/typed reception input to a userId:
//  - cardToken/code: the member card QR value (see extractCardToken above).
//    card_token is globally unique, so this lookup is not branch-filtered --
//    verifyAndCheckIn then rejects a cross-branch match as "wrong_branch".
//  - userId: direct id, for an already-known member (e.g. re-entry from a
//    detail screen).
//  - query: manual search fallback -- member code, email, or phone. Email
//    and phone are only unique per branch (uq_users_branch_email/phone), so
//    this lookup is scoped to branchId when one is given; otherwise LIMIT 1
//    could pick the other branch's account for the same person.
// Returns { userId, branchId } or null if nothing matched.
async function resolveMember({ cardToken, code, userId, query: search, branchId = null } = {}) {
  const token = cardToken || extractCardToken(code);
  if (token) {
    const rows = await query(
      "SELECT id, branch_id FROM users WHERE card_token = ? AND deleted_at IS NULL LIMIT 1",
      [token]
    );
    return rows[0] ? { userId: rows[0].id, branchId: Number(rows[0].branch_id) } : null;
  }

  if (userId) {
    const user = await userRepository.findById(userId);
    return user ? { userId: user.id, branchId: Number(user.branch_id) } : null;
  }

  const term = String(search || "").trim();
  if (term) {
    const where = ["deleted_at IS NULL", "(member_code = ? OR email = ? OR phone = ?)"];
    const params = [term, term.toLowerCase(), term];
    if (branchId != null) {
      where.push("branch_id = ?");
      params.push(branchId);
    }
    const rows = await query(`SELECT id, branch_id FROM users WHERE ${where.join(" AND ")} LIMIT 1`, params);
    return rows[0] ? { userId: rows[0].id, branchId: Number(rows[0].branch_id) } : null;
  }

  return null;
}

// The single verification + check-in seam described above.
//  - userId: the member to check in (already resolved -- see resolveMember
//    for turning a scanned QR / manual search into this).
//  - method: one of CHECKIN_METHODS (mirrors attendance_logs.method).
//  - adminId: the reception staff member performing the check-in (recorded
//    on the attendance_logs row, same as every other admin-authored write in
//    this app).
//  - branchId: the reception kiosk's own branch. When provided, a member
//    belonging to a different branch is rejected before any membership
//    lookup -- reception at one branch should never be able to check in a
//    member who belongs to the other branch, same cross-branch discipline
//    Part 1 built everywhere else. Optional so this function stays callable
//    from a context that has already branch-checked (e.g. a future
//    single-branch kiosk with no admin session at all).
//
// Returns:
//   { allowed: true, member, membership, attendance, duplicate }  -- checked in
//   { allowed: false, reason, member }                            -- rejected, no row created
// reason is one of: "not_found", "wrong_branch", "suspended",
// "inactive_account", "expired", "no_active_membership".
// member is null for "wrong_branch" -- reception at one branch never sees
// the other branch's member details (same no-leak rule as the admin 404s).
// duplicate is true when an open check-in from the last
// DUPLICATE_WINDOW_MINUTES was returned instead of a new row.
async function verifyAndCheckIn(userId, method = "manual", adminId = null, { branchId = null, notes = "" } = {}) {
  const normalizedMethod = CHECKIN_METHODS.includes(method) ? method : "manual";

  const user = await userRepository.findById(userId);
  if (!user) {
    return { allowed: false, reason: "not_found", member: null };
  }

  const member = {
    id: user.id,
    branchId: Number(user.branch_id),
    fullName: user.full_name,
    memberCode: user.member_code || null,
    status: user.status
  };

  if (branchId != null && Number(branchId) !== member.branchId) {
    return { allowed: false, reason: "wrong_branch", member: null };
  }

  if (user.status === "suspended") {
    return { allowed: false, reason: "suspended", member };
  }
  if (user.status === "inactive") {
    return { allowed: false, reason: "inactive_account", member };
  }

  const membership = await membershipRepository.activeMembership(userId);
  if (!membership) {
    const latest = await membershipRepository.latestMembership(userId);
    const expired = latest && (latest.status === "expired" || latest.status === "active");
    return { allowed: false, reason: expired ? "expired" : "no_active_membership", member };
  }

  // Lock the member row so two desks scanning the same member at once
  // serialize here: the second one sees the first one's row and returns it.
  const { attendance, duplicate } = await transaction(async (connection) => {
    await connection.execute("SELECT id FROM users WHERE id = ? FOR UPDATE", [member.id]);
    const existing = await attendanceRepository.findRecentOpenCheckIn(member.id, DUPLICATE_WINDOW_MINUTES, connection);
    if (existing) {
      return { attendance: { id: existing.id, status: "checked_in" }, duplicate: true };
    }
    const created = await attendanceRepository.checkIn(
      {
        branchId: member.branchId,
        userId: member.id,
        membershipId: membership.id,
        method: normalizedMethod,
        notes
      },
      adminId,
      connection
    );
    return { attendance: created, duplicate: false };
  });

  return {
    allowed: true,
    member,
    membership: {
      id: membership.id,
      endDate: membership.end_date,
      plan: { en: membership.plan_name_en, ar: membership.plan_name_ar }
    },
    attendance,
    duplicate
  };
}

module.exports = {
  CHECKIN_METHODS,
  DUPLICATE_WINDOW_MINUTES,
  extractCardToken,
  resolveMember,
  verifyAndCheckIn
};
