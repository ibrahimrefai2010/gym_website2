-- Part 2 §2.4: data import pipeline (parse -> validate -> preview -> commit).
-- A preview is stored server-side so the commit step applies exactly what
-- the admin reviewed (the client only sends the job id back), and a job can
-- only be committed once.
CREATE TABLE IF NOT EXISTS import_jobs (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  branch_id     INT UNSIGNED NOT NULL,
  entity        VARCHAR(40) NOT NULL,
  mode          ENUM('create','update') NOT NULL DEFAULT 'create',
  file_name     VARCHAR(255) DEFAULT NULL,
  status        ENUM('preview','committed','failed','expired') NOT NULL DEFAULT 'preview',
  total_rows    INT UNSIGNED NOT NULL DEFAULT 0,
  valid_rows    INT UNSIGNED NOT NULL DEFAULT 0,
  skipped_rows  INT UNSIGNED NOT NULL DEFAULT 0,
  committed_rows INT UNSIGNED NOT NULL DEFAULT 0,
  rows_json     LONGTEXT,
  result_json   LONGTEXT,
  created_by    INT UNSIGNED DEFAULT NULL,
  committed_by  INT UNSIGNED DEFAULT NULL,
  committed_at  DATETIME DEFAULT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_import_jobs_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_import_jobs_created_by FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_import_jobs_committed_by FOREIGN KEY (committed_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_import_jobs_branch_created (branch_id, created_at)
) ENGINE=InnoDB;

-- Members created by admins (and converted leads) never got a member code or
-- QR card token -- only self-registration set them. Backfill existing rows.
UPDATE users SET member_code = CONCAT('MFC-', LPAD(id, 6, '0')) WHERE member_code IS NULL;
UPDATE users SET card_token = REPLACE(UUID(), '-', '') WHERE card_token IS NULL;
