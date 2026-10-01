// Database backups (Part 2 §2.7.7): a real mysqldump of the whole database,
// gzipped into storage/backups/, with retention pruning.
//
//  - Triggered from Admin -> Backups (POST /api/v1/admin/backups), by the
//    BACKUP_CRON schedule (src/jobs/cron.js), or `npm run db:backup`.
//  - The DB password is passed through the MYSQL_PWD environment variable of
//    the child process, never on the command line (not visible in `ps`).
//  - --single-transaction gives a consistent InnoDB snapshot without locking
//    the live site.
//  - Set MYSQLDUMP_PATH if mysqldump is not on PATH.
//  - Copy storage/backups off the server too (see README) -- a backup on the
//    same disk is not a backup.

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const zlib = require("zlib");
const { spawn } = require("child_process");
const { pipeline } = require("stream/promises");
const { env } = require("../config/env");
const { hasDatabaseConfig } = require("../config/database");
const { auditLog } = require("../utils/logger");
const { createHttpError } = require("../utils/httpError");

const backupDir = path.join(__dirname, "..", "..", "storage", "backups");

function connectionConfig() {
  if (env.databaseUrl) {
    const url = new URL(env.databaseUrl);
    return {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, "")
    };
  }
  return { host: env.dbHost, port: env.dbPort, user: env.dbUser, password: env.dbPassword, database: env.dbName };
}

async function pruneOldBackups() {
  const days = Math.max(1, Number(env.backupRetentionDays) || 14);
  const cutoff = Date.now() - days * 86400000;
  const files = await fsp.readdir(backupDir);
  let removed = 0;
  for (const file of files) {
    if (!/^backup-.*\.sql\.gz$/.test(file)) continue;
    const stat = await fsp.stat(path.join(backupDir, file));
    if (stat.mtimeMs < cutoff) {
      await fsp.unlink(path.join(backupDir, file));
      removed += 1;
    }
  }
  return removed;
}

async function createBackup({ actorId = null, ipAddress = null, source = "manual" } = {}) {
  if (!hasDatabaseConfig()) {
    throw createHttpError(503, "No database is configured.", "DATABASE_REQUIRED");
  }
  await fsp.mkdir(backupDir, { recursive: true });
  const db = connectionConfig();
  const createdAt = new Date().toISOString();
  const filename = `backup-${db.database}-${createdAt.replace(/[:.]/g, "-")}.sql.gz`;
  const filePath = path.join(backupDir, filename);

  const child = spawn(
    process.env.MYSQLDUMP_PATH || "mysqldump",
    ["--single-transaction", "--routines", "--triggers", "--no-tablespaces", "--default-character-set=utf8mb4", "-h", db.host, "-P", String(db.port), "-u", db.user, db.database],
    { env: { ...process.env, MYSQL_PWD: db.password || "" }, windowsHide: true }
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const exited = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  try {
    await pipeline(child.stdout, zlib.createGzip({ level: 9 }), fs.createWriteStream(filePath, { mode: 0o600 }));
    const code = await exited;
    if (code !== 0) throw new Error(stderr.trim() || `mysqldump exited with ${code}`);
  } catch (error) {
    await fsp.unlink(filePath).catch(() => {});
    const message = error.code === "ENOENT" ? "mysqldump was not found. Install the MySQL client or set MYSQLDUMP_PATH." : "The database backup failed.";
    await auditLog({ actorType: "admin", actorId, action: "backup.failed", entityType: "backup", description: message, ipAddress, context: { source } }).catch(() => {});
    const httpError = createHttpError(500, message, "BACKUP_FAILED");
    httpError.details = String(error.message || "").slice(0, 500);
    throw httpError;
  }

  const { size } = await fsp.stat(filePath);
  const pruned = await pruneOldBackups();
  await auditLog({
    actorType: "admin",
    actorId,
    action: "backup.created",
    entityType: "backup",
    entityId: null,
    description: `Database backup (${source})`,
    ipAddress,
    context: { filename, size, pruned }
  }).catch(() => {});
  return { filename, size, createdAt, pruned };
}

async function listBackups() {
  await fsp.mkdir(backupDir, { recursive: true });
  const files = (await fsp.readdir(backupDir)).filter((file) => /^backup-.*\.sql\.gz$/.test(file));
  const items = [];
  for (const file of files) {
    const stat = await fsp.stat(path.join(backupDir, file));
    items.push({ filename: file, size: stat.size, createdAt: stat.mtime.toISOString() });
  }
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

module.exports = { backupDir, createBackup, listBackups };
