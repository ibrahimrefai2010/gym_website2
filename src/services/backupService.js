const fs = require("fs/promises");
const path = require("path");
const { env } = require("../config/env");
const { hasDatabaseConfig } = require("../config/database");
const { auditLog } = require("../utils/logger");

const backupDir = path.join(__dirname, "..", "..", "storage", "backups");

async function ensureBackupDir() {
  await fs.mkdir(backupDir, { recursive: true });
}

async function createBackup({ actorId, ipAddress }) {
  await ensureBackupDir();
  const createdAt = new Date().toISOString();
  const filename = `backup-${createdAt.replace(/[:.]/g, "-")}.json`;
  const filePath = path.join(backupDir, filename);
  const payload = {
    createdAt,
    databaseConfigured: hasDatabaseConfig(),
    database: hasDatabaseConfig() ? env.dbName || "DATABASE_URL" : "demo-mode",
    encrypted: false,
    note: "Backup pipeline is prepared. Wire this to mysqldump or managed MySQL snapshots in production."
  };

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  await auditLog({
    actorType: "admin",
    actorId,
    action: "backup.created",
    entityType: "backup",
    entityId: null,
    description: "Manual backup prepared",
    ipAddress,
    context: { filename }
  });

  return {
    filename,
    path: filePath,
    encrypted: false,
    createdAt
  };
}

async function listBackups() {
  await ensureBackupDir();
  const files = await fs.readdir(backupDir);
  return files
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({
      filename: file,
      path: path.join(backupDir, file)
    }));
}

module.exports = {
  createBackup,
  listBackups
};
