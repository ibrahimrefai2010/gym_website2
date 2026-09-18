-- Reverses 202609180003_tasks.up.sql.
DELETE FROM settings WHERE key_name IN ('task_autogen_expiring_memberships', 'task_autogen_new_leads');

DROP TABLE IF EXISTS tasks;
