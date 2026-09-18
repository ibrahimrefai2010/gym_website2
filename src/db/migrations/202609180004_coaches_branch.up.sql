-- Part 2, phase 2 (feature/women-branch, continued): Coaches.
--
-- `coaches` was created by 202609090001_admin_core.up.sql, which predates
-- the whole Women's-Branch schema work (202609180001_women_branch.up.sql)
-- and never got a branch_id column. Every business record in this app
-- belongs to exactly one branch (see that migration's plans/offers
-- treatment, and 202609180003_tasks's tasks table) -- coaches are no
-- exception, so this adds NOT NULL branch_id with the same FK style
-- (RESTRICT, not SET NULL: a branch with active coaches can't be silently
-- orphaned).
--
-- Existing rows (there should be none pre-launch, but defensively) default
-- to the Main branch (id 1), same backfill-then-tighten two-step every other
-- table in this migration family uses.

ALTER TABLE coaches ADD COLUMN branch_id INT UNSIGNED DEFAULT NULL AFTER id;
UPDATE coaches SET branch_id = 1 WHERE branch_id IS NULL;
ALTER TABLE coaches MODIFY COLUMN branch_id INT UNSIGNED NOT NULL;
ALTER TABLE coaches
  ADD CONSTRAINT fk_coaches_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  ADD INDEX idx_coaches_branch_active (branch_id, is_active, deleted_at, display_order);
