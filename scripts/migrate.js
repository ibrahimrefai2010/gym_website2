const fs = require("fs/promises");
const path = require("path");
const mysql = require("mysql2/promise");
const { env } = require("../src/config/env");
const { getPool, hasDatabaseConfig, query } = require("../src/config/database");
const rbacRepository = require("../src/repositories/rbacRepository");

const migrationsDir = path.join(__dirname, "..", "src", "db", "migrations");
const baseSchemaPath = path.join(__dirname, "..", "src", "db", "schema.sql");

function splitSql(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function ensureMigrationTable() {
  await query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      migration VARCHAR(190) NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`
  );
}

async function appliedMigrations() {
  const rows = await query("SELECT migration FROM schema_migrations ORDER BY migration ASC");
  return new Set(rows.map((row) => row.migration));
}

async function migrationFiles(direction) {
  const files = await fs.readdir(migrationsDir);
  return files
    .filter((file) => file.endsWith(`.${direction}.sql`))
    .sort()
    .map((file) => ({
      file,
      migration: file.replace(`.${direction}.sql`, ""),
      path: path.join(migrationsDir, file)
    }));
}

// Errors that only mean "this statement was already applied" (column/key/FK
// already exists, or already gone). MySQL/MariaDB DDL is not transactional, so
// a migration that failed part-way leaves its earlier statements in place;
// `--resume` skips exactly these and re-runs the rest. Each skip is printed.
const ALREADY_APPLIED_ERRNOS = new Set([1050, 1060, 1061, 1068, 1091, 1553, 1826, 3940]);
function isAlreadyApplied(error) {
  if (ALREADY_APPLIED_ERRNOS.has(error?.errno)) {
    return true;
  }
  // MariaDB reports a duplicate foreign-key name as a generic 1005 / errno 121.
  return error?.errno === 1005 && /errno:\s*121|duplicate/i.test(error.message || "");
}

async function runSqlFile(filePath, { resume = false } = {}) {
  const sql = await fs.readFile(filePath, "utf8");
  for (const statement of splitSql(sql)) {
    try {
      await query(statement);
    } catch (error) {
      if (!resume || !isAlreadyApplied(error)) {
        throw error;
      }
      const firstLine = statement.split(/\r?\n/).find((line) => line.trim() && !line.trim().startsWith("--")) || statement;
      process.stdout.write(`  skipped (already applied): ${firstLine.trim().slice(0, 100)}\n`);
    }
  }
}

function quoteIdentifier(identifier) {
  return `\`${String(identifier).replace(/`/g, "``")}\``;
}

async function ensureDatabaseExists() {
  if (env.databaseUrl || !env.dbHost || !env.dbUser || !env.dbName) {
    return;
  }

  const connection = await mysql.createConnection({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword
  });
  try {
    await connection.execute(
      `CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(env.dbName)}
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await connection.end();
  }
}

async function hasBaseSchema() {
  try {
    await Promise.all([
      query("SELECT id FROM users LIMIT 1"),
      query("SELECT id FROM admin_users LIMIT 1"),
      query("SELECT id FROM plans LIMIT 1"),
      query("SELECT key_name FROM settings LIMIT 1")
    ]);
    return true;
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") {
      return false;
    }
    throw error;
  }
}

async function ensureBaseSchema() {
  if (await hasBaseSchema()) {
    return false;
  }

  const sql = await fs.readFile(baseSchemaPath, "utf8");
  const statements = splitSql(sql).filter(
    (statement) => !/^CREATE\s+DATABASE\b/i.test(statement) && !/^USE\b/i.test(statement)
  );
  for (const statement of statements) {
    await query(statement);
  }
  return true;
}

async function migrateUp({ resume = false } = {}) {
  await ensureDatabaseExists();
  const initializedBase = await ensureBaseSchema();
  if (initializedBase) {
    process.stdout.write("Initialized base schema.\n");
  }
  await ensureMigrationTable();
  const applied = await appliedMigrations();
  const files = await migrationFiles("up");
  let appliedCount = 0;

  for (const file of files) {
    if (applied.has(file.migration)) {
      continue;
    }
    await runSqlFile(file.path, { resume });
    await query("INSERT INTO schema_migrations (migration) VALUES (?)", [file.migration]);
    process.stdout.write(`Applied ${file.migration}\n`);
    appliedCount += 1;
  }

  if (appliedCount > 0) {
    const sync = await rbacRepository.syncDefaults({ backfill: true });
    process.stdout.write(`Synced RBAC defaults: ${sync.roles} roles, ${sync.permissions} permissions.\n`);
  }

  if (appliedCount === 0) {
    process.stdout.write("No pending migrations.\n");
  }
}

async function migrateDown(targetMigration) {
  await ensureMigrationTable();
  const applied = await appliedMigrations();
  const files = await migrationFiles("down");
  const appliedList = [...applied].sort();
  const target = targetMigration || appliedList[appliedList.length - 1];

  if (!target || !applied.has(target)) {
    throw new Error("No applied migration found to roll back.");
  }

  const file = files.find((item) => item.migration === target);
  if (!file) {
    throw new Error(`Rollback file not found for ${target}.`);
  }

  await runSqlFile(file.path);
  await query("DELETE FROM schema_migrations WHERE migration = ?", [target]);
  process.stdout.write(`Rolled back ${target}\n`);
}

async function main() {
  if (!hasDatabaseConfig()) {
    throw new Error("Set DB_HOST, DB_USER, and DB_NAME or DATABASE_URL before running migrations.");
  }

  const direction = process.argv[2] || "up";
  if (direction === "up") {
    await migrateUp({ resume: process.argv.includes("--resume") });
    return;
  }
  if (direction === "down") {
    await migrateDown(process.argv[3]);
    return;
  }
  throw new Error("Usage: node scripts/migrate.js [up [--resume]|down] [migration_name]");
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    const pool = getPool();
    if (pool) {
      await pool.end();
    }
  });
