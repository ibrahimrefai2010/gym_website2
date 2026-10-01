-- Part 2 §2.0.9: in-app notification bell for admins. The feed is derived
-- from existing records (leads, payments, members, tasks); an admin's
-- unread count is everything newer than when they last opened the bell.
-- (The audit viewer's branch + time filter is already covered by the
-- existing idx_logs_branch_created index.)
ALTER TABLE admin_users ADD COLUMN notifications_seen_at DATETIME DEFAULT NULL AFTER last_login_ip;
