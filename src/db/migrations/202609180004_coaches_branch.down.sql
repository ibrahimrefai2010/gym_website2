-- Reverses 202609180004_coaches_branch.up.sql.
ALTER TABLE coaches DROP FOREIGN KEY fk_coaches_branch;
ALTER TABLE coaches DROP INDEX idx_coaches_branch_active;
ALTER TABLE coaches DROP COLUMN branch_id;
