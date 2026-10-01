-- Part 2 §2.0.1 / §2.0.7: branch-scoped leads + member at-risk settings.
--
-- 1. messages (contact-form leads) had no branch_id, so both branches'
--    admins saw each other's inquiries. A lead belongs to the branch whose
--    site it was submitted on (the subdomain-resolved req.branch). Existing
--    rows predate the Women's branch and backfill to Main (id 1).
ALTER TABLE messages ADD COLUMN branch_id INT UNSIGNED DEFAULT NULL AFTER id;
UPDATE messages SET branch_id = 1 WHERE branch_id IS NULL;
ALTER TABLE messages MODIFY COLUMN branch_id INT UNSIGNED NOT NULL;
ALTER TABLE messages
  ADD CONSTRAINT fk_messages_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  ADD INDEX idx_messages_branch_created (branch_id, created_at);

-- 2. At-risk members: an active member with no check-in for this many days
--    is flagged on the dashboard and (if enabled) gets a follow-up task.
INSERT INTO settings (branch_id, key_name, value, type, label_en, label_ar)
SELECT b.id, 'member_inactivity_days', '14', 'number',
       'Days without a visit before a member is flagged at-risk', 'عدد أيام الغياب قبل اعتبار العضو معرّضًا للانسحاب'
FROM branches b
ON DUPLICATE KEY UPDATE key_name = VALUES(key_name);

INSERT INTO settings (branch_id, key_name, value, type, label_en, label_ar)
SELECT b.id, 'task_autogen_at_risk_members', 'true', 'boolean',
       'Auto-create tasks for at-risk (inactive) members', 'إنشاء مهام تلقائية للأعضاء المنقطعين'
FROM branches b
ON DUPLICATE KEY UPDATE key_name = VALUES(key_name);
