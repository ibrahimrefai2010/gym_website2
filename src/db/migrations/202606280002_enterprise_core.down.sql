ALTER TABLE logs
  DROP FOREIGN KEY fk_logs_branch,
  DROP INDEX idx_logs_branch_created,
  DROP INDEX idx_logs_target,
  DROP COLUMN branch_id,
  DROP COLUMN actor_role,
  DROP COLUMN description,
  DROP COLUMN old_value,
  DROP COLUMN new_value,
  DROP COLUMN user_agent,
  DROP COLUMN reason,
  DROP COLUMN updated_at;

DROP TABLE IF EXISTS push_notifications;
DROP TABLE IF EXISTS sms_queue;
DROP TABLE IF EXISTS whatsapp_queue;
DROP TABLE IF EXISTS email_queue;
DROP TABLE IF EXISTS job_queue;
DROP TABLE IF EXISTS system_logs;
DROP TABLE IF EXISTS backup_records;
DROP TABLE IF EXISTS ai_recommendations;
DROP TABLE IF EXISTS ai_logs;
DROP TABLE IF EXISTS report_cache;

ALTER TABLE expenses DROP FOREIGN KEY fk_expenses_attachment_document;
DROP TABLE IF EXISTS documents;
DROP TABLE IF EXISTS promotions;
DROP TABLE IF EXISTS discounts;
DROP TABLE IF EXISTS coupons;
DROP TABLE IF EXISTS subscription_extensions;
DROP TABLE IF EXISTS membership_freezes;
DROP TABLE IF EXISTS holidays;
DROP TABLE IF EXISTS attendance_logs;
DROP TABLE IF EXISTS income_entries;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS expense_categories;

ALTER TABLE payments
  DROP FOREIGN KEY fk_payments_branch,
  DROP FOREIGN KEY fk_payments_invoice,
  DROP FOREIGN KEY fk_payments_method,
  DROP FOREIGN KEY fk_payments_employee,
  DROP FOREIGN KEY fk_payments_created_by,
  DROP FOREIGN KEY fk_payments_updated_by,
  DROP INDEX idx_payments_branch_status_created,
  DROP INDEX idx_payments_invoice_status,
  DROP COLUMN branch_id,
  DROP COLUMN invoice_id,
  DROP COLUMN payment_method_id,
  DROP COLUMN employee_id,
  DROP COLUMN created_by,
  DROP COLUMN updated_by;

DROP TABLE IF EXISTS invoice_items;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS customer_notes;
DROP TABLE IF EXISTS medical_records;
DROP TABLE IF EXISTS emergency_contacts;
DROP TABLE IF EXISTS customer_profiles;
DROP TABLE IF EXISTS payment_methods;

ALTER TABLE memberships
  DROP FOREIGN KEY fk_memberships_branch,
  DROP FOREIGN KEY fk_memberships_created_by,
  DROP FOREIGN KEY fk_memberships_updated_by,
  DROP INDEX idx_memberships_branch_status_end,
  DROP COLUMN branch_id,
  DROP COLUMN created_by,
  DROP COLUMN updated_by;

ALTER TABLE offers
  DROP FOREIGN KEY fk_offers_branch,
  DROP FOREIGN KEY fk_offers_created_by,
  DROP FOREIGN KEY fk_offers_updated_by,
  DROP INDEX idx_offers_branch_public,
  DROP COLUMN branch_id,
  DROP COLUMN created_by,
  DROP COLUMN updated_by;

ALTER TABLE plans
  DROP FOREIGN KEY fk_plans_branch,
  DROP FOREIGN KEY fk_plans_created_by,
  DROP FOREIGN KEY fk_plans_updated_by,
  DROP INDEX idx_plans_branch_public,
  DROP COLUMN branch_id,
  DROP COLUMN created_by,
  DROP COLUMN updated_by;

ALTER TABLE admin_users
  DROP FOREIGN KEY fk_admin_users_branch,
  DROP FOREIGN KEY fk_admin_users_created_by,
  DROP FOREIGN KEY fk_admin_users_updated_by,
  DROP INDEX idx_admin_users_branch_status,
  DROP COLUMN branch_id,
  DROP COLUMN created_by,
  DROP COLUMN updated_by;

ALTER TABLE users
  DROP FOREIGN KEY fk_users_branch,
  DROP FOREIGN KEY fk_users_created_by,
  DROP FOREIGN KEY fk_users_updated_by,
  DROP INDEX idx_users_branch_status_created,
  DROP COLUMN branch_id,
  DROP COLUMN created_by,
  DROP COLUMN updated_by;

DROP TABLE IF EXISTS branches;
