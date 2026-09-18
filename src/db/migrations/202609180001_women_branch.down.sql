-- Reverses 202609180001_women_branch.up.sql. Intended to run cleanly right
-- after the up migration in a dev/test environment (before Women's-branch
-- data has actually been created against these tables). If real Women's
-- branch invoices/counters/business rows exist by the time this runs, some
-- steps below (e.g. collapsing invoice_counters back to a single PK) can fail
-- on duplicate keys -- that's expected of a forward-only ZATCA numbering
-- scheme and mirrors this repo's existing "forward-only" invoicing rule.

-- 10. otp_tokens
ALTER TABLE otp_tokens DROP FOREIGN KEY fk_otp_tokens_branch;
ALTER TABLE otp_tokens DROP INDEX idx_otp_tokens_branch_identifier;
ALTER TABLE otp_tokens DROP COLUMN branch_id;

-- 9. slider_images / homepage_text
ALTER TABLE homepage_text DROP FOREIGN KEY fk_homepage_text_branch;
ALTER TABLE homepage_text DROP INDEX uq_homepage_text_branch_section;
ALTER TABLE homepage_text DROP COLUMN branch_id;
ALTER TABLE homepage_text ADD UNIQUE KEY section_key (section_key);

ALTER TABLE slider_images DROP FOREIGN KEY fk_slider_images_branch;
ALTER TABLE slider_images DROP INDEX idx_slider_images_branch;
ALTER TABLE slider_images DROP COLUMN branch_id;

-- 8. business_settings: drop the Women's placeholder row, then collapse back
--    to the fixed singleton shape.
DELETE bs FROM business_settings bs
  JOIN branches b ON b.id = bs.branch_id
  WHERE b.code = 'women';

ALTER TABLE business_settings DROP FOREIGN KEY fk_business_settings_branch;
ALTER TABLE business_settings DROP INDEX uq_business_settings_branch;
ALTER TABLE business_settings DROP COLUMN branch_id;
ALTER TABLE business_settings MODIFY COLUMN id TINYINT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE business_settings
  ADD CONSTRAINT chk_business_settings_singleton CHECK (id = 1);

-- 7. invoice_counters
ALTER TABLE invoice_counters DROP FOREIGN KEY fk_invoice_counters_branch;
ALTER TABLE invoice_counters DROP PRIMARY KEY;
ALTER TABLE invoice_counters ADD PRIMARY KEY (hijri_year);
ALTER TABLE invoice_counters DROP COLUMN branch_id;

-- 6. invoices
ALTER TABLE invoices DROP INDEX uq_invoices_branch_hijri_seq;
ALTER TABLE invoices ADD UNIQUE KEY uq_invoices_hijri_seq (hijri_year, invoice_seq);

-- 5. offers
ALTER TABLE offers DROP FOREIGN KEY fk_offers_branch;
ALTER TABLE offers MODIFY COLUMN branch_id INT UNSIGNED DEFAULT NULL;
ALTER TABLE offers
  ADD CONSTRAINT fk_offers_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;

-- 4. plans
ALTER TABLE plans DROP FOREIGN KEY fk_plans_branch;
ALTER TABLE plans MODIFY COLUMN branch_id INT UNSIGNED DEFAULT NULL;
ALTER TABLE plans
  ADD CONSTRAINT fk_plans_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;

-- 3. admin_users
ALTER TABLE admin_users DROP FOREIGN KEY fk_admin_users_branch;
ALTER TABLE admin_users MODIFY COLUMN branch_id INT UNSIGNED DEFAULT 1;
ALTER TABLE admin_users
  ADD CONSTRAINT fk_admin_users_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;

-- 2. users
ALTER TABLE users DROP INDEX uq_users_branch_email;
ALTER TABLE users DROP INDEX uq_users_branch_phone;
ALTER TABLE users DROP FOREIGN KEY fk_users_branch;
ALTER TABLE users MODIFY COLUMN branch_id INT UNSIGNED DEFAULT 1;
ALTER TABLE users
  ADD CONSTRAINT fk_users_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  ADD UNIQUE KEY email (email),
  ADD UNIQUE KEY phone (phone);

-- 1. Women's Branch row.
DELETE FROM branches WHERE code = 'women';
