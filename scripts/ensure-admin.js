const crypto = require("crypto");
const { getPool, hasDatabaseConfig, query } = require("../src/config/database");
const { hashPassword } = require("../src/utils/hash");

const email = process.env.ADMIN_EMAIL || "admin@localhost.test";
const fullName = process.env.ADMIN_FULL_NAME || "System Administrator";
const phone = process.env.ADMIN_PHONE || null;
const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(18).toString("base64url");

async function ensureAdmin() {
  if (!hasDatabaseConfig()) {
    throw new Error("Database is not configured. Set DB_HOST, DB_USER, DB_NAME and DB_PASSWORD, or DATABASE_URL.");
  }

  const existing = await query(
    `SELECT id, full_name, email, role, status
     FROM admin_users
     WHERE deleted_at IS NULL
     ORDER BY created_at ASC`
  );

  if (existing.length > 0) {
    process.stdout.write(`Admin account already exists (${existing.length} total):\n`);
    for (const admin of existing) {
      process.stdout.write(`- #${admin.id} ${admin.email} (${admin.role}, ${admin.status})\n`);
    }
    return;
  }

  const result = await query(
    `INSERT INTO admin_users (full_name, email, phone, password_hash, role, status)
     VALUES (?, ?, ?, ?, 'super_admin', 'active')`,
    [fullName, email.toLowerCase(), phone, await hashPassword(password)]
  );

  process.stdout.write("Created super admin account:\n");
  process.stdout.write(`- id: ${result.insertId}\n`);
  process.stdout.write(`- email: ${email.toLowerCase()}\n`);
  process.stdout.write(`- password: ${password}\n`);
}

ensureAdmin()
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    const pool = getPool();
    if (pool) {
      await pool.end();
    }
  });
