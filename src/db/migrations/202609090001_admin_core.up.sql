-- Phase 1 (feature/admin-core): additive foundation for the bilingual admin panel,
-- ZATCA invoicing, Moyasar payments, and CRM. All statements are ADD COLUMN /
-- CREATE TABLE / ENUM-widen only -- no existing data is modified or dropped.

-- 1. Legal / tax identity for ZATCA simplified tax invoices (single row).
--    Display name, phone, and hours stay in `settings`; this table holds only
--    fields that do not already exist elsewhere.
CREATE TABLE IF NOT EXISTS business_settings (
  id                   TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  legal_entity_name_ar VARCHAR(200) NOT NULL DEFAULT '',
  legal_entity_name_en VARCHAR(200) NOT NULL DEFAULT '',
  vat_number           VARCHAR(20)  NOT NULL DEFAULT '',
  cr_number            VARCHAR(40)  NOT NULL DEFAULT '',
  owner_id_number      VARCHAR(40)  NOT NULL DEFAULT '',
  vat_rate             DECIMAL(5,2) NOT NULL DEFAULT 15.00,
  vat_effective_date   DATE DEFAULT NULL,
  municipality_ar      VARCHAR(160) NOT NULL DEFAULT '',
  municipality_en      VARCHAR(160) NOT NULL DEFAULT '',
  district_ar          VARCHAR(160) NOT NULL DEFAULT '',
  district_en          VARCHAR(160) NOT NULL DEFAULT '',
  street_ar            VARCHAR(160) NOT NULL DEFAULT '',
  street_en            VARCHAR(160) NOT NULL DEFAULT '',
  building_number      VARCHAR(20)  NOT NULL DEFAULT '',
  postal_code          VARCHAR(20)  NOT NULL DEFAULT '',
  city_ar              VARCHAR(120) NOT NULL DEFAULT '',
  city_en              VARCHAR(120) NOT NULL DEFAULT '',
  country_code         CHAR(2) NOT NULL DEFAULT 'SA',
  updated_by           INT UNSIGNED DEFAULT NULL,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_business_settings_singleton CHECK (id = 1),
  CONSTRAINT fk_business_settings_updated_by FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT INTO business_settings
  (id, legal_entity_name_ar, legal_entity_name_en, vat_number, cr_number, owner_id_number,
   vat_rate, vat_effective_date, municipality_ar, municipality_en, district_ar, street_ar,
   city_ar, city_en, country_code)
VALUES
  (1, 'مؤسسة مركز بناء ولياقة الرياضي', 'Muscle and Fitness Center Establishment',
   '310160591300003', '39055011', '7007550036',
   15.00, '2019-01-01', 'أمانة منطقة جازان', 'Jazan Municipality', 'الرحاب 1', 'الزواوي',
   'جازان', 'Jazan', 'SA')
ON DUPLICATE KEY UPDATE vat_number = VALUES(vat_number);

-- 2. Coaches: public-facing profile, optionally linked 1:1 to a staff login.
CREATE TABLE IF NOT EXISTS coaches (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_user_id     INT UNSIGNED DEFAULT NULL,
  name_ar           VARCHAR(160) NOT NULL,
  name_en           VARCHAR(160) NOT NULL,
  specialty_ar      VARCHAR(200) NOT NULL DEFAULT '',
  specialty_en      VARCHAR(200) NOT NULL DEFAULT '',
  bio_ar            TEXT,
  bio_en            TEXT,
  certifications_ar TEXT,
  certifications_en TEXT,
  years_experience  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  photo_url         VARCHAR(255) DEFAULT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  display_order     INT NOT NULL DEFAULT 0,
  created_by        INT UNSIGNED DEFAULT NULL,
  updated_by        INT UNSIGNED DEFAULT NULL,
  deleted_at        DATETIME DEFAULT NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_coaches_admin_user (admin_user_id),
  CONSTRAINT fk_coaches_admin_user FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_coaches_created_by FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_coaches_updated_by FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_coaches_public (is_active, deleted_at, display_order)
) ENGINE=InnoDB;

-- 3. Member -> coach assignment (single coach per member; NULL = unassigned).
ALTER TABLE customer_profiles
  ADD COLUMN coach_id INT UNSIGNED DEFAULT NULL AFTER trainer_notes,
  ADD CONSTRAINT fk_customer_profiles_coach FOREIGN KEY (coach_id) REFERENCES coaches(id) ON DELETE SET NULL,
  ADD INDEX idx_customer_profiles_coach (coach_id);

-- 4. Admin account: forced first-login password change + last-login audit.
ALTER TABLE admin_users
  ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE AFTER status,
  ADD COLUMN last_login_at DATETIME DEFAULT NULL AFTER must_change_password,
  ADD COLUMN last_login_ip VARCHAR(45) DEFAULT NULL AFTER last_login_at;

-- 5. Idle-session tracking for the 8h admin timeout (enforced at refresh-token
--    rotation; does not shorten the refresh-token lifetime for members).
ALTER TABLE refresh_tokens
  ADD COLUMN last_used_at DATETIME DEFAULT NULL AFTER created_at;

-- 6. Leads / CRM: extend `messages` rather than a new table. `status`
--    (unread/read/archived) stays as the "seen" concept; `lead_status` is the
--    CRM pipeline.
ALTER TABLE messages
  ADD COLUMN source VARCHAR(40) NOT NULL DEFAULT 'contact_form' AFTER message,
  ADD COLUMN lead_status ENUM('new','contacted','converted','rejected') NOT NULL DEFAULT 'new' AFTER status,
  ADD COLUMN assigned_to INT UNSIGNED DEFAULT NULL AFTER lead_status,
  ADD COLUMN converted_user_id INT UNSIGNED DEFAULT NULL AFTER assigned_to,
  ADD CONSTRAINT fk_messages_assigned_to FOREIGN KEY (assigned_to) REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_messages_converted_user FOREIGN KEY (converted_user_id) REFERENCES users(id) ON DELETE SET NULL,
  ADD INDEX idx_messages_lead_status (lead_status, created_at),
  ADD INDEX idx_messages_source (source);

CREATE TABLE IF NOT EXISTS lead_notes (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id INT UNSIGNED NOT NULL,
  note       TEXT NOT NULL,
  created_by INT UNSIGNED DEFAULT NULL,
  deleted_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_lead_notes_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_lead_notes_created_by FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_lead_notes_message_created (message_id, created_at)
) ENGINE=InnoDB;

-- 7. Payments: add `moyasar` as a provider / method; add `bank_transfer` method
--    (already a seeded row in `payment_methods`).
ALTER TABLE payments
  MODIFY COLUMN provider ENUM('manual','stripe','tabby','tamara','moyasar') NOT NULL DEFAULT 'manual',
  MODIFY COLUMN payment_method ENUM('cash','card','bank_transfer','manual','stripe','tabby','tamara','moyasar') NOT NULL DEFAULT 'manual';

ALTER TABLE payment_events
  MODIFY COLUMN provider ENUM('stripe','tabby','tamara','manual','moyasar') NOT NULL;

INSERT INTO payment_methods (key_name, display_name, provider, is_enabled, sort_order)
VALUES ('moyasar', 'Moyasar (Mada / Visa / Mastercard / Apple Pay)', 'moyasar', 0, 7)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), provider = VALUES(provider);

-- 8. Plans: bilingual features list as {"en":[...], "ar":[...]}.
ALTER TABLE plans
  ADD COLUMN features JSON DEFAULT NULL AFTER description_en;

-- 9. Invoices: ZATCA Phase 1 fields + Hijri-year sequential numbering.
ALTER TABLE invoices
  ADD COLUMN issued_at DATETIME DEFAULT NULL AFTER issue_date,
  ADD COLUMN hijri_year SMALLINT UNSIGNED DEFAULT NULL AFTER issued_at,
  ADD COLUMN invoice_seq INT UNSIGNED DEFAULT NULL AFTER hijri_year,
  ADD COLUMN buyer_name VARCHAR(200) DEFAULT NULL AFTER invoice_seq,
  ADD COLUMN buyer_phone VARCHAR(40) DEFAULT NULL AFTER buyer_name,
  ADD COLUMN buyer_vat_number VARCHAR(20) DEFAULT NULL AFTER buyer_phone,
  ADD COLUMN zatca_qr MEDIUMTEXT DEFAULT NULL AFTER buyer_vat_number,
  ADD COLUMN pdf_generated_at DATETIME DEFAULT NULL AFTER zatca_qr,
  ADD UNIQUE KEY uq_invoices_hijri_seq (hijri_year, invoice_seq);

CREATE TABLE IF NOT EXISTS invoice_counters (
  hijri_year SMALLINT UNSIGNED NOT NULL PRIMARY KEY,
  last_seq   INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
