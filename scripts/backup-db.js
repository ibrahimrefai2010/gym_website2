// npm run db:backup -- one-off database backup (same code path as the admin
// "Backups" button and the BACKUP_CRON schedule). See README > Backups.
const backupService = require("../src/services/backupService");
const { getPool } = require("../src/config/database");

backupService
  .createBackup({ source: "cli" })
  .then((result) => console.log(`Backup written: storage/backups/${result.filename} (${result.size} bytes, pruned ${result.pruned})`))
  .catch((error) => {
    console.error(error.message, error.details || "");
    process.exitCode = 1;
  })
  .finally(async () => {
    const pool = getPool();
    if (pool) await pool.end();
  });
