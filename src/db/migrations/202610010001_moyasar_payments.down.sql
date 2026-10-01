-- Reverses 202610010001_moyasar_payments.up.sql.
DELETE FROM settings WHERE key_name = 'task_autogen_failed_payments';
ALTER TABLE payments DROP FOREIGN KEY fk_payments_plan;
ALTER TABLE payments
  DROP INDEX idx_payments_provider_reference,
  DROP INDEX idx_payments_provider_status,
  DROP COLUMN plan_id,
  DROP COLUMN purpose,
  DROP COLUMN checkout_url,
  DROP COLUMN failure_reason,
  DROP COLUMN expires_at;
