const { createHttpError } = require("../utils/httpError");
const { hasDatabaseConfig, query } = require("../config/database");
const { hashPassword } = require("../utils/hash");
const planRepository = require("./planRepository");
const offerRepository = require("./offerRepository");
const membershipRepository = require("./membershipRepository");
const messageRepository = require("./messageRepository");
const settingsRepository = require("./settingsRepository");
const sliderRepository = require("./sliderRepository");
const rbacRepository = require("./rbacRepository");
const taskRepository = require("./taskRepository");

function ensureDatabase() {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "Database configuration is required.", "DATABASE_REQUIRED");
  }
}

function publicAdmin(row) {
  if (!row) return null;
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    type: "admin",
    status: row.status,
    mustChangePassword: Boolean(row.must_change_password),
    lastLoginAt: row.last_login_at || null,
    // Frontend needs this to know the admin's home branch (for the badge)
    // and whether to show the branch switcher (role check is a client-side
    // convenience only -- see src/security/branchAccess.js for the real,
    // server-side enforcement). branchCode/branchName come from the join
    // below so a branch-scoped admin (who typically lacks branches:manage
    // and therefore can't call GET /api/v1/branches) can still render their
    // own branch's name on the badge.
    branchId: row.branch_id != null ? Number(row.branch_id) : null,
    branchCode: row.branch_code || null,
    branchName: row.branch_code ? { en: row.branch_name_en || "", ar: row.branch_name_ar || "" } : null
  };
}

async function findForLogin(identifier) {
  ensureDatabase();
  const normalized = String(identifier || "").trim().toLowerCase();
  const rows = await query(
    `SELECT au.id, au.branch_id, au.full_name, au.email, au.phone, au.role, au.status,
       au.password_hash, au.must_change_password, au.last_login_at,
       b.code AS branch_code, b.name_en AS branch_name_en, b.name_ar AS branch_name_ar
     FROM admin_users au
     LEFT JOIN branches b ON b.id = au.branch_id
     WHERE au.deleted_at IS NULL AND LOWER(au.email) = ?
     LIMIT 1`,
    [normalized]
  );
  return rows[0] || null;
}

async function findById(id) {
  ensureDatabase();
  const rows = await query(
    `SELECT au.id, au.branch_id, au.full_name, au.email, au.phone, au.role, au.status,
       au.must_change_password, au.last_login_at,
       b.code AS branch_code, b.name_en AS branch_name_en, b.name_ar AS branch_name_ar
     FROM admin_users au
     LEFT JOIN branches b ON b.id = au.branch_id
     WHERE au.id = ? AND au.deleted_at IS NULL
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function findForLoginById(id) {
  ensureDatabase();
  const rows = await query(
    `SELECT id, password_hash, must_change_password
     FROM admin_users
     WHERE id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function recordLogin(id, ipAddress = null) {
  ensureDatabase();
  await query(
    "UPDATE admin_users SET last_login_at = UTC_TIMESTAMP(), last_login_ip = ? WHERE id = ?",
    [ipAddress || null, id]
  );
}

async function updatePassword(id, plainPassword) {
  ensureDatabase();
  await query(
    "UPDATE admin_users SET password_hash = ?, must_change_password = 0, updated_at = UTC_TIMESTAMP() WHERE id = ?",
    [await hashPassword(plainPassword), id]
  );
}

async function createAdmin(payload) {
  ensureDatabase();
  try {
    const result = await query(
      `INSERT INTO admin_users (full_name, email, phone, password_hash, role, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
      [
        payload.fullName,
        payload.email,
        payload.phone || null,
        await hashPassword(payload.password),
        payload.role || "staff"
      ]
    );
    return publicAdmin(await findById(result.insertId));
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      throw createHttpError(409, "An admin with this email already exists.", "ADMIN_EXISTS");
    }
    throw error;
  }
}

// branchId scopes every branch-aware query below to one branch's data --
// see the report for which of these tables genuinely have no branch_id
// column (messages, notifications) and are therefore left global by design,
// not by oversight.
async function getOverview(branchId = 1) {
  ensureDatabase();
  const [statsRows, users, payments, logs, messages, memberships, adminAccounts, notifications, tasksByPriority, overdueTasks] =
    await Promise.all([
      query(
        `SELECT
          (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND branch_id = ?) AS total_users,
          (SELECT COUNT(*) FROM memberships WHERE status = 'active' AND branch_id = ?) AS active_members,
          (SELECT COUNT(*) FROM memberships WHERE status = 'expired' AND branch_id = ?) AS expired_members,
          (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'completed' AND branch_id = ? AND completed_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY) AS monthly_revenue,
          (SELECT COUNT(*) FROM payments WHERE status = 'pending' AND branch_id = ?) AS pending_payments,
          (SELECT COUNT(*) FROM messages WHERE status = 'unread') AS unread_messages,
          (SELECT COUNT(*) FROM users WHERE DATE(created_at) = UTC_DATE() AND deleted_at IS NULL AND branch_id = ?) AS todays_new_users,
          (SELECT COUNT(*) FROM notifications WHERE is_read = 0) AS open_notifications`,
        [branchId, branchId, branchId, branchId, branchId, branchId]
      ),
      query(
        `SELECT u.id, u.full_name, u.email, u.phone, u.status, p.name_en AS plan
         FROM users u
         LEFT JOIN memberships m ON m.user_id = u.id AND m.status = 'active'
         LEFT JOIN plans p ON p.id = m.plan_id
         WHERE u.deleted_at IS NULL AND u.branch_id = ?
         ORDER BY u.created_at DESC
         LIMIT 8`,
        [branchId]
      ),
      query(
        `SELECT p.id, u.full_name AS member, p.amount, p.currency, p.payment_method, p.status, p.created_at, p.completed_at
         FROM payments p
         LEFT JOIN users u ON u.id = p.user_id
         WHERE p.branch_id = ?
         ORDER BY p.created_at DESC
         LIMIT 8`,
        [branchId]
      ),
      // logs.branch_id is nullable and, today, only populated by the write
      // paths this feature threads a branchId through (plan/offer/settings
      // saves) -- most other actions across the app still log branch_id =
      // NULL. Treating NULL as "not yet branch-tagged, visible everywhere"
      // avoids a regression where every branch-scoped admin would otherwise
      // see zero historical logs. See report for the full explanation.
      query(
        `SELECT id, actor_type, action, target_table, target_id, meta, created_at
         FROM logs
         WHERE branch_id = ? OR branch_id IS NULL
         ORDER BY created_at DESC
         LIMIT 10`,
        [branchId]
      ),
      // messages (contact-form leads) has no branch_id column -- left global.
      query("SELECT id, name, email, phone, subject, status, created_at FROM messages ORDER BY created_at DESC LIMIT 10"),
      membershipRepository.listMemberships(branchId),
      query(
        `SELECT id, full_name AS username, email, role, created_at
         FROM admin_users
         WHERE deleted_at IS NULL AND branch_id = ?
         ORDER BY created_at DESC`,
        [branchId]
      ),
      // notifications has no branch_id column (only user_id) -- left global.
      query("SELECT id, type, title_en, title_ar, is_read, created_at FROM notifications ORDER BY created_at DESC LIMIT 10"),
      // Tasks/Follow-ups "Open Tasks" dashboard widget (count by priority +
      // overdue count), branch-scope aware like everything else here.
      taskRepository.countOpenByPriority({ branchId }),
      taskRepository.countOverdue({ branchId })
    ]);

  const stats = statsRows[0] || {};

  return {
    stats: [
      { label: { en: "Total users", ar: "إجمالي المستخدمين" }, value: String(stats.total_users || 0), delta: "" },
      { label: { en: "Active memberships", ar: "العضويات النشطة" }, value: String(stats.active_members || 0), delta: "" },
      { label: { en: "Expired memberships", ar: "العضويات المنتهية" }, value: String(stats.expired_members || 0), delta: "" },
      {
        label: { en: "Monthly revenue", ar: "الإيراد الشهري" },
        value: `SAR ${Number(stats.monthly_revenue || 0).toFixed(2)}`,
        delta: ""
      },
      { label: { en: "Pending payments", ar: "مدفوعات معلقة" }, value: String(stats.pending_payments || 0), delta: "" },
      { label: { en: "Unread messages", ar: "رسائل غير مقروءة" }, value: String(stats.unread_messages || 0), delta: "" },
      { label: { en: "Today's new users", ar: "مستخدمون جدد اليوم" }, value: String(stats.todays_new_users || 0), delta: "" },
      { label: { en: "Open notifications", ar: "تنبيهات مفتوحة" }, value: String(stats.open_notifications || 0), delta: "" }
    ],
    users: users.map((user) => ({
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      phone: user.phone,
      status: user.status,
      plan: user.plan || "None"
    })),
    memberships,
    tasks: {
      byPriority: tasksByPriority,
      overdue: overdueTasks
    },
    payments: payments.map((payment) => ({
      id: payment.id,
      member: payment.member || "Unknown",
      amount: `${payment.currency} ${Number(payment.amount).toFixed(2)}`,
      method: payment.payment_method,
      status: payment.status,
      date: payment.completed_at || payment.created_at
    })),
    logs: logs.map((log) => ({
      id: log.id,
      level: "info",
      action: log.action,
      message: log.action,
      createdAt: log.created_at
    })),
    messages: messages.map((message) => ({ ...message, createdAt: message.created_at })),
    notifications: notifications.map((item) => ({ ...item, createdAt: item.created_at })),
    adminAccounts,
    charts: {
      revenue: [],
      growth: []
    }
  };
}

// Resources filtered by branchId below are grouped by whether the
// underlying table actually has a branch_id column (see report for the
// full audit):
//  - Has branch_id, now filtered: plans, offers, settings, siteImages,
//    slides (nullable branch_id -- includes both branch-specific and
//    global-fallback rows), users, memberships (own branch_id column, not
//    joined through users), payments, adminAccounts, logs (nullable, see
//    getOverview's comment on why NULL rows stay visible everywhere).
//  - Genuinely has no branch_id column, left unfiltered by design:
//    messages (contact-form leads), notifications (only has user_id).
async function listResource(resource, branchId = 1) {
  ensureDatabase();
  if (resource === "roles") return rbacRepository.listRoles();
  if (resource === "permissions") return rbacRepository.listPermissions();
  if (resource === "adminRoleAssignments") return rbacRepository.listAdminRoleAssignments();
  if (resource === "notificationBroadcasts") return listBroadcasts();

  if (resource === "plans") return planRepository.listPlans({ includeInactive: true, branchId });
  if (resource === "offers") return offerRepository.listOffers({ includeInactive: true, branchId });
  if (resource === "settings") return settingsRepository.listSettings(branchId);
  if (resource === "siteImages") return settingsRepository.settingsToBootstrap(await settingsRepository.publicSettings(branchId)).siteImages;
  if (resource === "slides") return sliderRepository.listSlides({ includeInactive: true, branchId });
  if (resource === "messages") return messageRepository.listMessages();

  if (resource === "users") {
    return query(
      "SELECT id, full_name, email, phone, status, created_at FROM users WHERE deleted_at IS NULL AND branch_id = ? ORDER BY created_at DESC LIMIT 50",
      [branchId]
    );
  }
  if (resource === "memberships") {
    return query(
      `SELECT m.id, u.full_name AS member, p.name_en AS plan, m.start_date, m.end_date, m.status
       FROM memberships m JOIN users u ON u.id = m.user_id JOIN plans p ON p.id = m.plan_id
       WHERE m.branch_id = ?
       ORDER BY COALESCE(m.end_date, m.created_at) DESC LIMIT 50`,
      [branchId]
    );
  }
  if (resource === "payments") {
    return query(
      `SELECT id, user_id, membership_id, amount, currency, payment_method, provider, status, created_at, completed_at
       FROM payments
       WHERE branch_id = ?
       ORDER BY created_at DESC LIMIT 50`,
      [branchId]
    );
  }
  if (resource === "logs") {
    return query(
      `SELECT id, actor_type, actor_id, action, target_table, target_id, meta, ip_address, created_at
       FROM logs
       WHERE branch_id = ? OR branch_id IS NULL
       ORDER BY created_at DESC LIMIT 50`,
      [branchId]
    );
  }
  if (resource === "adminAccounts") {
    return query(
      `SELECT id, full_name AS username, email, role, created_at
       FROM admin_users
       WHERE deleted_at IS NULL AND branch_id = ?
       ORDER BY created_at DESC`,
      [branchId]
    );
  }
  if (resource === "notifications") {
    return query(
      "SELECT id, user_id, type, title_en, title_ar, is_read, created_at FROM notifications ORDER BY created_at DESC LIMIT 50"
    );
  }

  throw createHttpError(404, "Resource not found.", "RESOURCE_NOT_FOUND");
}

async function savePlan(payload) {
  return planRepository.savePlan(payload);
}

async function saveOffer(payload) {
  return offerRepository.saveOffer(payload);
}

async function saveSetting(payload, adminId = null, branchId = 1) {
  ensureDatabase();
  return settingsRepository.saveSetting(payload.key, payload.value, adminId, payload.type, branchId);
}

async function saveSiteImages(payload, adminId = null, branchId = 1) {
  ensureDatabase();
  return settingsRepository.saveSiteImages(payload, adminId, branchId);
}

async function saveSlide(payload) {
  return sliderRepository.saveSlide(payload);
}

async function saveRole(payload) {
  return rbacRepository.saveRole(payload);
}

async function savePermission(payload) {
  return rbacRepository.savePermission(payload);
}

async function setRolePermissions(payload, adminId = null) {
  return rbacRepository.setRolePermissions({
    roleKey: payload.roleKey || payload.role || payload.key,
    permissionKeys: payload.permissionKeys || payload.permissions || [],
    grantedBy: adminId
  });
}

async function setAdminRoles(payload, adminId = null) {
  return rbacRepository.setAdminRoles({
    adminId: payload.adminId || payload.admin_user_id,
    roleKeys: payload.roleKeys || payload.roles || [],
    grantedBy: adminId
  });
}

const BROADCAST_TYPES = ["announcement", "promo", "notice"];
const BROADCAST_AUDIENCES = ["all", "active", "expiring", "member"];

function cleanText(value, maxLength) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

async function broadcastNotification(payload = {}) {
  ensureDatabase();
  const type = BROADCAST_TYPES.includes(payload.type) ? payload.type : "announcement";
  const audience = BROADCAST_AUDIENCES.includes(payload.audience) ? payload.audience : "all";
  const titleEn = cleanText(payload.titleEn, 200);
  const titleAr = cleanText(payload.titleAr, 200);
  const bodyEn = cleanText(payload.bodyEn, 2000);
  const bodyAr = cleanText(payload.bodyAr, 2000);

  if (!titleEn || !titleAr || !bodyEn || !bodyAr) {
    throw createHttpError(422, "Title and message are required in both languages.", "ANNOUNCEMENT_FIELDS_REQUIRED");
  }

  const values = [type, titleAr, titleEn, bodyAr, bodyEn];

  if (audience === "member") {
    const memberId = Number.parseInt(payload.userId ?? payload.memberId, 10);
    if (!Number.isInteger(memberId) || memberId < 1) {
      throw createHttpError(422, "Select a valid member.", "ANNOUNCEMENT_MEMBER_REQUIRED");
    }
    const exists = await query("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1", [memberId]);
    if (!exists[0]) {
      throw createHttpError(404, "Member not found.", "MEMBER_NOT_FOUND");
    }
    const result = await query(
      `INSERT INTO notifications (user_id, type, title_ar, title_en, body_ar, body_en)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [memberId, ...values]
    );
    return { recipients: result.affectedRows || 1, audience, type };
  }

  let audienceSql = "u.deleted_at IS NULL AND u.status = 'active'";
  if (audience === "active") {
    audienceSql += ` AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = u.id AND m.status = 'active' AND (m.end_date IS NULL OR m.end_date >= UTC_DATE())
    )`;
  } else if (audience === "expiring") {
    audienceSql += ` AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = u.id AND m.status = 'active'
        AND m.end_date IS NOT NULL
        AND m.end_date BETWEEN UTC_DATE() AND UTC_DATE() + INTERVAL 7 DAY
    )`;
  }

  const result = await query(
    `INSERT INTO notifications (user_id, type, title_ar, title_en, body_ar, body_en)
     SELECT u.id, ?, ?, ?, ?, ?
     FROM users u
     WHERE ${audienceSql}`,
    values
  );
  return { recipients: result.affectedRows || 0, audience, type };
}

async function listBroadcasts() {
  ensureDatabase();
  const rows = await query(
    `SELECT type, title_en, title_ar,
       COUNT(*) AS recipients,
       SUM(is_read) AS read_count,
       MAX(created_at) AS sent_at
     FROM notifications
     WHERE type IN ('announcement', 'promo', 'notice')
     GROUP BY type, title_en, title_ar, DATE(created_at)
     ORDER BY sent_at DESC
     LIMIT 30`
  );
  return rows.map((row) => ({
    type: row.type,
    titleEn: row.title_en,
    titleAr: row.title_ar,
    recipients: Number(row.recipients || 0),
    readCount: Number(row.read_count || 0),
    sentAt: row.sent_at
  }));
}

async function rbacCatalog() {
  return rbacRepository.getCatalog();
}

async function syncRbacDefaults() {
  return rbacRepository.syncDefaults({ backfill: true });
}

module.exports = {
  broadcastNotification,
  createAdmin,
  findById,
  findForLogin,
  findForLoginById,
  getOverview,
  recordLogin,
  updatePassword,
  listBroadcasts,
  listResource,
  publicAdmin,
  rbacCatalog,
  saveOffer,
  savePermission,
  savePlan,
  saveRole,
  saveSetting,
  saveSiteImages,
  saveSlide,
  setAdminRoles,
  setRolePermissions,
  syncRbacDefaults
};
