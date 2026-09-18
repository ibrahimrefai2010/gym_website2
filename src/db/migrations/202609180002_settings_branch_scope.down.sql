-- Reverses 202609180002_settings_branch_scope.up.sql.
-- Deletes any non-Main branch settings rows before collapsing the PK back to
-- a single global key_name -- mirrors the forward-only-aware pattern used by
-- 202609180001_women_branch's business_settings down migration (delete the
-- branch-specific rows first, since collapsing to a single key_name PK would
-- otherwise violate uniqueness once a Women's-branch row for the same key
-- exists).
DELETE s FROM settings s
  JOIN branches b ON b.id = s.branch_id
  WHERE b.code <> 'main';

ALTER TABLE settings DROP FOREIGN KEY fk_settings_branch;
ALTER TABLE settings DROP PRIMARY KEY;
ALTER TABLE settings ADD PRIMARY KEY (key_name);
ALTER TABLE settings DROP COLUMN branch_id;
