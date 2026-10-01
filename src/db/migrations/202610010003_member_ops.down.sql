-- Reverses 202610010003_member_ops.up.sql.
DELETE FROM settings WHERE key_name IN ('member_inactivity_days', 'task_autogen_at_risk_members');
ALTER TABLE messages DROP FOREIGN KEY fk_messages_branch;
ALTER TABLE messages DROP INDEX idx_messages_branch_created;
ALTER TABLE messages DROP COLUMN branch_id;
