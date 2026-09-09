-- Rollback for 202609090001_admin_core. Drops only what the up migration added.

DROP TABLE IF EXISTS invoice_counters;

ALTER TABLE invoices
  DROP KEY uq_invoices_hijri_seq,
  DROP COLUMN issued_at,
  DROP COLUMN hijri_year,
  DROP COLUMN invoice_seq,
  DROP COLUMN buyer_name,
  DROP COLUMN buyer_phone,
  DROP COLUMN buyer_vat_number,
  DROP COLUMN zatca_qr,
  DROP COLUMN pdf_generated_at;

ALTER TABLE plans
  DROP COLUMN features;

DELETE FROM payment_methods WHERE key_name = 'moyasar';

ALTER TABLE payment_events
  MODIFY COLUMN provider ENUM('stripe','tabby','tamara','manual') NOT NULL;

ALTER TABLE payments
  MODIFY COLUMN provider ENUM('manual','stripe','tabby','tamara') NOT NULL DEFAULT 'manual',
  MODIFY COLUMN payment_method ENUM('cash','card','manual','stripe','tabby','tamara') NOT NULL DEFAULT 'manual';

DROP TABLE IF EXISTS lead_notes;

ALTER TABLE messages
  DROP FOREIGN KEY fk_messages_assigned_to,
  DROP FOREIGN KEY fk_messages_converted_user,
  DROP KEY idx_messages_lead_status,
  DROP KEY idx_messages_source,
  DROP COLUMN source,
  DROP COLUMN lead_status,
  DROP COLUMN assigned_to,
  DROP COLUMN converted_user_id;

ALTER TABLE refresh_tokens
  DROP COLUMN last_used_at;

ALTER TABLE admin_users
  DROP COLUMN must_change_password,
  DROP COLUMN last_login_at,
  DROP COLUMN last_login_ip;

ALTER TABLE customer_profiles
  DROP FOREIGN KEY fk_customer_profiles_coach,
  DROP KEY idx_customer_profiles_coach,
  DROP COLUMN coach_id;

DROP TABLE IF EXISTS coaches;

DROP TABLE IF EXISTS business_settings;
