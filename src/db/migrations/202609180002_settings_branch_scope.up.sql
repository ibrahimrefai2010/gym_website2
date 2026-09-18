-- Fixes a real gap left by 202609180001_women_branch: `settings` (brand
-- name, motto, working hours, hero/logo image URLs -- see
-- src/db/schema.sql:190-199) was left un-branch-scoped, so every branch
-- shared one global row per key_name. That's wrong: the feature's actual
-- definition of done requires the Women's branch to show its own brand
-- name, hero image, and motto, which live in this exact table.
--
-- Adds branch_id and re-keys the table so each branch owns its own row per
-- key_name, matching the FK/PK style 202609180001_women_branch already used
-- for invoice_counters (composite PK keyed by branch first).

ALTER TABLE settings ADD COLUMN branch_id INT UNSIGNED NOT NULL DEFAULT 1 AFTER key_name;

-- Existing rows already default to branch_id = 1 (Main) via the column
-- default above; this UPDATE is a no-op safety net only.
UPDATE settings SET branch_id = 1 WHERE branch_id IS NULL;

ALTER TABLE settings DROP PRIMARY KEY;
ALTER TABLE settings ADD PRIMARY KEY (branch_id, key_name);
ALTER TABLE settings
  ADD CONSTRAINT fk_settings_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT;
