-- Phase 2/3 (feature/women-branch): add the Women's Branch as a second row in
-- the existing generic `branches` table (never a men|women enum), and make
-- every table/repo that must not leak data across branches branch-aware.
--
-- Owner-confirmed decisions this migration encodes:
--  - Two separate VAT registrations -> business_settings becomes one row per
--    branch; invoice numbering (invoice_counters + uq on invoices) becomes
--    branch-scoped so each branch's Hijri-year sequence is independent.
--  - Plans/offers: NOT NULL branch_id, no shared "both branches" NULL tier.
--  - Users: branch_id + composite (branch_id, email) / (branch_id, phone)
--    uniqueness instead of the old global-unique columns.
--  - FAQs: left untouched entirely (deliberate, no branch_id).
--
-- This migration is schema/reference-data only. It does NOT seed Women's
-- branch content (plans/offers/settings/slider/homepage rows) -- that is a
-- separate phase per the brief.

-- 1. The Women's Branch row itself (reference data, not "content").
INSERT INTO branches (code, name_en, name_ar, status)
VALUES ('women', 'Women''s Branch', 'الفرع النسائي', 'active')
ON DUPLICATE KEY UPDATE name_en = VALUES(name_en), name_ar = VALUES(name_ar), status = VALUES(status);

-- 2. users: branch_id was added nullable (DEFAULT 1) by 202606280002; the old
--    global UNIQUE(email) / UNIQUE(phone) were never removed. Make branch_id
--    reliably NOT NULL, then replace the global uniques with composite ones.
UPDATE users SET branch_id = 1 WHERE branch_id IS NULL;
ALTER TABLE users DROP FOREIGN KEY fk_users_branch;
ALTER TABLE users MODIFY COLUMN branch_id INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE users
  ADD CONSTRAINT fk_users_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT;
ALTER TABLE users DROP INDEX email;
ALTER TABLE users DROP INDEX phone;
ALTER TABLE users
  ADD UNIQUE KEY uq_users_branch_email (branch_id, email),
  ADD UNIQUE KEY uq_users_branch_phone (branch_id, phone);

-- 3. admin_users: same defensive NOT NULL (email stays globally unique --
--    admin accounts are not a tenant boundary the way member accounts are,
--    and this is not part of the owner-confirmed decisions list).
UPDATE admin_users SET branch_id = 1 WHERE branch_id IS NULL;
ALTER TABLE admin_users DROP FOREIGN KEY fk_admin_users_branch;
ALTER TABLE admin_users MODIFY COLUMN branch_id INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE admin_users
  ADD CONSTRAINT fk_admin_users_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT;

-- 4. plans: NOT NULL branch_id (decision 3), FK SET NULL -> RESTRICT so a
--    branch with active plans can't be silently orphaned.
UPDATE plans SET branch_id = 1 WHERE branch_id IS NULL;
ALTER TABLE plans DROP FOREIGN KEY fk_plans_branch;
ALTER TABLE plans MODIFY COLUMN branch_id INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE plans
  ADD CONSTRAINT fk_plans_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT;

-- 5. offers: same treatment as plans.
UPDATE offers SET branch_id = 1 WHERE branch_id IS NULL;
ALTER TABLE offers DROP FOREIGN KEY fk_offers_branch;
ALTER TABLE offers MODIFY COLUMN branch_id INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE offers
  ADD CONSTRAINT fk_offers_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT;

-- 6. invoices: the ZATCA gap-free sequence uniqueness must be per branch, not
--    global, now that two branches each mint their own Hijri-year sequence.
ALTER TABLE invoices DROP INDEX uq_invoices_hijri_seq;
ALTER TABLE invoices
  ADD UNIQUE KEY uq_invoices_branch_hijri_seq (branch_id, hijri_year, invoice_seq);

-- 7. invoice_counters: PK becomes (branch_id, hijri_year) so each branch's
--    counter is independent and locked/incremented separately.
ALTER TABLE invoice_counters ADD COLUMN branch_id INT UNSIGNED NOT NULL DEFAULT 1 FIRST;
ALTER TABLE invoice_counters DROP PRIMARY KEY;
ALTER TABLE invoice_counters ADD PRIMARY KEY (branch_id, hijri_year);
ALTER TABLE invoice_counters
  ADD CONSTRAINT fk_invoice_counters_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT;

-- 8. business_settings: was a fixed singleton (id TINYINT PK, CHECK id=1)
--    holding one shared VAT/CR registration. Two separate legal VAT
--    registrations means one row per branch now.
-- DROP CONSTRAINT (not MySQL-only DROP CHECK) so MariaDB 10.2+ and MySQL 8.0.19+ both accept it.
ALTER TABLE business_settings DROP CONSTRAINT chk_business_settings_singleton;
ALTER TABLE business_settings MODIFY COLUMN id INT UNSIGNED NOT NULL AUTO_INCREMENT;
ALTER TABLE business_settings ADD COLUMN branch_id INT UNSIGNED NULL AFTER id;
UPDATE business_settings SET branch_id = 1 WHERE id = 1;
ALTER TABLE business_settings MODIFY COLUMN branch_id INT UNSIGNED NOT NULL;
ALTER TABLE business_settings
  ADD UNIQUE KEY uq_business_settings_branch (branch_id),
  ADD CONSTRAINT fk_business_settings_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT;

-- Placeholder row for the Women's branch's own registration. Left blank
-- (matches the table's own column defaults) -- the real 15-digit VAT number
-- is a business detail nobody has supplied yet; createInvoice() already
-- refuses to issue invoices until a 15-digit VAT number is set via
-- Admin -> Settings -> Business Info, so this is safe as a placeholder.
INSERT INTO business_settings (branch_id)
SELECT b.id FROM branches b WHERE b.code = 'women'
ON DUPLICATE KEY UPDATE branch_id = branch_id;

-- 9. slider_images / homepage_text: add nullable branch_id so a future
--    per-branch override can exist alongside today's rows. Existing rows
--    stay branch_id = NULL ("applies to all branches" / global fallback) --
--    seeding actual Women's-branch-specific rows is a separate phase.
ALTER TABLE slider_images ADD COLUMN branch_id INT UNSIGNED DEFAULT NULL AFTER id;
ALTER TABLE slider_images
  ADD CONSTRAINT fk_slider_images_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  ADD INDEX idx_slider_images_branch (branch_id);

ALTER TABLE homepage_text DROP INDEX section_key;
ALTER TABLE homepage_text ADD COLUMN branch_id INT UNSIGNED DEFAULT NULL AFTER id;
ALTER TABLE homepage_text
  ADD CONSTRAINT fk_homepage_text_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  ADD UNIQUE KEY uq_homepage_text_branch_section (branch_id, section_key);

-- NOTE: `settings` (key_name-only PK) and `faqs` are intentionally left
-- untouched. `faqs` per explicit owner decision (content doesn't differ by
-- branch). `settings` would need a PK restructure (key_name is not
-- branch-scoped) that isn't part of the owner-confirmed decision list and
-- would touch ~10 unrelated call sites; publicRepository/settingsRepository
-- gain a branchId parameter for forward-compatibility, but it is a no-op
-- until a future migration adds real per-branch storage. See report.

-- 10. otp_tokens: identifier-only lookup (email/phone), no user_id FK. Once
--     (branch_id, email) uniqueness allows the same email in both branches,
--     an OTP for one branch's account must not verify against the other's.
--     password_reset_tokens is keyed on user_id (already branch-safe via the
--     user row itself) and does not need this.
ALTER TABLE otp_tokens ADD COLUMN branch_id INT UNSIGNED NOT NULL DEFAULT 1 AFTER identifier;
ALTER TABLE otp_tokens
  ADD CONSTRAINT fk_otp_tokens_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  ADD INDEX idx_otp_tokens_branch_identifier (branch_id, identifier);
