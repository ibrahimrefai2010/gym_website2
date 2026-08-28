CREATE TABLE IF NOT EXISTS branches (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code          VARCHAR(40) NOT NULL UNIQUE,
  name_en       VARCHAR(160) NOT NULL,
  name_ar       VARCHAR(160) NOT NULL,
  address_en    VARCHAR(255) DEFAULT '',
  address_ar    VARCHAR(255) DEFAULT '',
  phone         VARCHAR(40) DEFAULT '',
  manager_id    INT UNSIGNED DEFAULT NULL,
  status        ENUM('active','inactive') NOT NULL DEFAULT 'active',
  metadata      JSON DEFAULT NULL,
  created_by    INT UNSIGNED DEFAULT NULL,
  updated_by    INT UNSIGNED DEFAULT NULL,
  deleted_at    DATETIME DEFAULT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (manager_id) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_branches_status_deleted (status, deleted_at),
  INDEX idx_branches_manager (manager_id)
) ENGINE=InnoDB;

INSERT INTO branches (id, code, name_en, name_ar, status)
VALUES (1, 'main', 'Main Branch', 'الفرع الرئيسي', 'active')
ON DUPLICATE KEY UPDATE name_en = VALUES(name_en), name_ar = VALUES(name_ar), status = VALUES(status);

ALTER TABLE users
  ADD COLUMN branch_id INT UNSIGNED DEFAULT 1 AFTER id,
  ADD COLUMN created_by INT UNSIGNED DEFAULT NULL AFTER deleted_at,
  ADD COLUMN updated_by INT UNSIGNED DEFAULT NULL AFTER created_by,
  ADD CONSTRAINT fk_users_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_users_created_by FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_users_updated_by FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD INDEX idx_users_branch_status_created (branch_id, status, created_at);

ALTER TABLE admin_users
  ADD COLUMN branch_id INT UNSIGNED DEFAULT 1 AFTER id,
  ADD COLUMN created_by INT UNSIGNED DEFAULT NULL AFTER deleted_at,
  ADD COLUMN updated_by INT UNSIGNED DEFAULT NULL AFTER created_by,
  ADD CONSTRAINT fk_admin_users_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_admin_users_created_by FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_admin_users_updated_by FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD INDEX idx_admin_users_branch_status (branch_id, status, deleted_at);

ALTER TABLE plans
  ADD COLUMN branch_id INT UNSIGNED DEFAULT NULL AFTER id,
  ADD COLUMN created_by INT UNSIGNED DEFAULT NULL AFTER deleted_at,
  ADD COLUMN updated_by INT UNSIGNED DEFAULT NULL AFTER created_by,
  ADD CONSTRAINT fk_plans_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_plans_created_by FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_plans_updated_by FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD INDEX idx_plans_branch_public (branch_id, is_active, deleted_at, sort_order);

ALTER TABLE offers
  ADD COLUMN branch_id INT UNSIGNED DEFAULT NULL AFTER id,
  ADD COLUMN created_by INT UNSIGNED DEFAULT NULL AFTER deleted_at,
  ADD COLUMN updated_by INT UNSIGNED DEFAULT NULL AFTER created_by,
  ADD CONSTRAINT fk_offers_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_offers_created_by FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_offers_updated_by FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD INDEX idx_offers_branch_public (branch_id, expires_at, is_active, deleted_at);

ALTER TABLE memberships
  ADD COLUMN branch_id INT UNSIGNED DEFAULT 1 AFTER id,
  ADD COLUMN created_by INT UNSIGNED DEFAULT NULL AFTER cancelled_at,
  ADD COLUMN updated_by INT UNSIGNED DEFAULT NULL AFTER created_by,
  ADD CONSTRAINT fk_memberships_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_memberships_created_by FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_memberships_updated_by FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD INDEX idx_memberships_branch_status_end (branch_id, status, end_date);

CREATE TABLE IF NOT EXISTS payment_methods (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  key_name      VARCHAR(80) NOT NULL UNIQUE,
  display_name  VARCHAR(120) NOT NULL,
  provider      VARCHAR(80) NOT NULL DEFAULT 'manual',
  config        JSON DEFAULT NULL,
  is_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order    INT NOT NULL DEFAULT 0,
  created_by    INT UNSIGNED DEFAULT NULL,
  updated_by    INT UNSIGNED DEFAULT NULL,
  deleted_at    DATETIME DEFAULT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_payment_methods_enabled (is_enabled, deleted_at, sort_order)
) ENGINE=InnoDB;

INSERT INTO payment_methods (key_name, display_name, provider, is_enabled, sort_order)
VALUES
('cash', 'Cash', 'manual', 1, 1),
('card', 'Card', 'manual', 1, 2),
('bank_transfer', 'Bank Transfer', 'manual', 1, 3),
('apple_pay', 'Apple Pay', 'gateway', 0, 4),
('google_pay', 'Google Pay', 'gateway', 0, 5),
('stripe', 'Stripe', 'stripe', 0, 6)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), provider = VALUES(provider), sort_order = VALUES(sort_order);

CREATE TABLE IF NOT EXISTS customer_profiles (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id            INT UNSIGNED NOT NULL UNIQUE,
  branch_id          INT UNSIGNED DEFAULT 1,
  national_id        VARCHAR(80) DEFAULT NULL,
  passport_number    VARCHAR(80) DEFAULT NULL,
  residency_number   VARCHAR(80) DEFAULT NULL,
  nationality        VARCHAR(80) DEFAULT '',
  gender             ENUM('male','female','other','unspecified') NOT NULL DEFAULT 'unspecified',
  birth_date         DATE DEFAULT NULL,
  occupation         VARCHAR(120) DEFAULT '',
  company            VARCHAR(160) DEFAULT '',
  address            VARCHAR(255) DEFAULT '',
  city               VARCHAR(120) DEFAULT '',
  country            VARCHAR(120) DEFAULT '',
  height_cm          DECIMAL(6,2) DEFAULT NULL,
  weight_kg          DECIMAL(6,2) DEFAULT NULL,
  body_fat_percent   DECIMAL(5,2) DEFAULT NULL,
  goals              TEXT,
  trainer_notes      TEXT,
  tags               JSON DEFAULT NULL,
  metadata           JSON DEFAULT NULL,
  created_by         INT UNSIGNED DEFAULT NULL,
  updated_by         INT UNSIGNED DEFAULT NULL,
  deleted_at         DATETIME DEFAULT NULL,
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_customer_profiles_branch_gender (branch_id, gender, deleted_at),
  INDEX idx_customer_profiles_identity (national_id, passport_number, residency_number),
  FULLTEXT INDEX ft_customer_profiles_search (national_id, passport_number, residency_number, nationality, city, company)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS emergency_contacts (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      INT UNSIGNED NOT NULL,
  name         VARCHAR(160) NOT NULL,
  phone        VARCHAR(40) NOT NULL,
  relationship VARCHAR(80) DEFAULT '',
  is_primary   BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   INT UNSIGNED DEFAULT NULL,
  updated_by   INT UNSIGNED DEFAULT NULL,
  deleted_at   DATETIME DEFAULT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_emergency_contacts_user (user_id, deleted_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS medical_records (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id        INT UNSIGNED NOT NULL,
  record_type    ENUM('note','disease','allergy','injury','medication','measurement') NOT NULL DEFAULT 'note',
  title          VARCHAR(160) NOT NULL,
  details        TEXT,
  recorded_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by     INT UNSIGNED DEFAULT NULL,
  updated_by     INT UNSIGNED DEFAULT NULL,
  deleted_at     DATETIME DEFAULT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_medical_records_user_type (user_id, record_type, deleted_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customer_notes (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  note       TEXT NOT NULL,
  visibility ENUM('internal','trainer','support') NOT NULL DEFAULT 'internal',
  created_by INT UNSIGNED DEFAULT NULL,
  updated_by INT UNSIGNED DEFAULT NULL,
  deleted_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_customer_notes_user_created (user_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoices (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  branch_id       INT UNSIGNED DEFAULT 1,
  user_id         INT UNSIGNED NOT NULL,
  membership_id   INT UNSIGNED DEFAULT NULL,
  invoice_number  VARCHAR(80) NOT NULL UNIQUE,
  status          ENUM('draft','pending','paid','partial','cancelled','refunded') NOT NULL DEFAULT 'pending',
  issue_date      DATE NOT NULL,
  due_date        DATE DEFAULT NULL,
  subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_total  DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_total       DECIMAL(12,2) NOT NULL DEFAULT 0,
  total           DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid_total      DECIMAL(12,2) NOT NULL DEFAULT 0,
  balance_due     DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency        CHAR(3) NOT NULL DEFAULT 'SAR',
  notes           TEXT,
  metadata        JSON DEFAULT NULL,
  created_by      INT UNSIGNED DEFAULT NULL,
  updated_by      INT UNSIGNED DEFAULT NULL,
  deleted_at      DATETIME DEFAULT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_invoices_user_status (user_id, status, deleted_at),
  INDEX idx_invoices_branch_date_status (branch_id, issue_date, status),
  INDEX idx_invoices_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoice_items (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_id   BIGINT UNSIGNED NOT NULL,
  plan_id      INT UNSIGNED DEFAULT NULL,
  item_type    ENUM('membership','service','product','fee','discount','other') NOT NULL DEFAULT 'other',
  description  VARCHAR(255) NOT NULL,
  quantity     DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit_price   DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount     DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_rate     DECIMAL(5,2) NOT NULL DEFAULT 0,
  tax_amount   DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_total   DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_by   INT UNSIGNED DEFAULT NULL,
  updated_by   INT UNSIGNED DEFAULT NULL,
  deleted_at   DATETIME DEFAULT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_invoice_items_invoice (invoice_id, deleted_at)
) ENGINE=InnoDB;

ALTER TABLE payments
  ADD COLUMN branch_id INT UNSIGNED DEFAULT 1 AFTER id,
  ADD COLUMN invoice_id BIGINT UNSIGNED DEFAULT NULL AFTER membership_id,
  ADD COLUMN payment_method_id INT UNSIGNED DEFAULT NULL AFTER payment_method,
  ADD COLUMN employee_id INT UNSIGNED DEFAULT NULL AFTER completed_by,
  ADD COLUMN created_by INT UNSIGNED DEFAULT NULL AFTER employee_id,
  ADD COLUMN updated_by INT UNSIGNED DEFAULT NULL AFTER created_by,
  ADD CONSTRAINT fk_payments_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_payments_method FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_payments_employee FOREIGN KEY (employee_id) REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_payments_created_by FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_payments_updated_by FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD INDEX idx_payments_branch_status_created (branch_id, status, created_at),
  ADD INDEX idx_payments_invoice_status (invoice_id, status);

CREATE TABLE IF NOT EXISTS expense_categories (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name_en     VARCHAR(120) NOT NULL,
  name_ar     VARCHAR(120) NOT NULL,
  code        VARCHAR(60) NOT NULL UNIQUE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  INT UNSIGNED DEFAULT NULL,
  updated_by  INT UNSIGNED DEFAULT NULL,
  deleted_at  DATETIME DEFAULT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_expense_categories_active (is_active, deleted_at)
) ENGINE=InnoDB;

INSERT INTO expense_categories (name_en, name_ar, code, is_active)
VALUES
('Rent', 'الإيجار', 'rent', 1),
('Electricity', 'الكهرباء', 'electricity', 1),
('Water', 'المياه', 'water', 1),
('Salaries', 'الرواتب', 'salaries', 1),
('Maintenance', 'الصيانة', 'maintenance', 1),
('Marketing', 'التسويق', 'marketing', 1),
('Equipment', 'المعدات', 'equipment', 1),
('Cleaning', 'النظافة', 'cleaning', 1),
('Other', 'أخرى', 'other', 1)
ON DUPLICATE KEY UPDATE name_en = VALUES(name_en), name_ar = VALUES(name_ar), is_active = VALUES(is_active);

CREATE TABLE IF NOT EXISTS expenses (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  branch_id     INT UNSIGNED DEFAULT 1,
  category_id   INT UNSIGNED DEFAULT NULL,
  employee_id   INT UNSIGNED DEFAULT NULL,
  title         VARCHAR(180) NOT NULL,
  description   TEXT,
  amount        DECIMAL(12,2) NOT NULL,
  currency      CHAR(3) NOT NULL DEFAULT 'SAR',
  expense_date  DATE NOT NULL,
  status        ENUM('draft','pending','approved','rejected','paid','cancelled') NOT NULL DEFAULT 'pending',
  approved_by   INT UNSIGNED DEFAULT NULL,
  approved_at   DATETIME DEFAULT NULL,
  attachment_document_id BIGINT UNSIGNED DEFAULT NULL,
  metadata      JSON DEFAULT NULL,
  created_by    INT UNSIGNED DEFAULT NULL,
  updated_by    INT UNSIGNED DEFAULT NULL,
  deleted_at    DATETIME DEFAULT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (category_id) REFERENCES expense_categories(id) ON DELETE SET NULL,
  FOREIGN KEY (employee_id) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_expenses_branch_date_status (branch_id, expense_date, status),
  INDEX idx_expenses_category_date (category_id, expense_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS income_entries (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  branch_id   INT UNSIGNED DEFAULT 1,
  source_type VARCHAR(80) NOT NULL DEFAULT 'manual',
  source_id   BIGINT UNSIGNED DEFAULT NULL,
  title       VARCHAR(180) NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  currency    CHAR(3) NOT NULL DEFAULT 'SAR',
  income_date DATE NOT NULL,
  notes       TEXT,
  created_by  INT UNSIGNED DEFAULT NULL,
  updated_by  INT UNSIGNED DEFAULT NULL,
  deleted_at  DATETIME DEFAULT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_income_branch_date (branch_id, income_date),
  INDEX idx_income_source (source_type, source_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS attendance_logs (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  branch_id     INT UNSIGNED DEFAULT 1,
  user_id       INT UNSIGNED NOT NULL,
  membership_id INT UNSIGNED DEFAULT NULL,
  check_in_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  check_out_at  DATETIME DEFAULT NULL,
  method        ENUM('manual','qr','mobile','kiosk','import') NOT NULL DEFAULT 'manual',
  status        ENUM('checked_in','checked_out','void') NOT NULL DEFAULT 'checked_in',
  recorded_by   INT UNSIGNED DEFAULT NULL,
  notes         VARCHAR(255) DEFAULT '',
  created_by    INT UNSIGNED DEFAULT NULL,
  updated_by    INT UNSIGNED DEFAULT NULL,
  deleted_at    DATETIME DEFAULT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE SET NULL,
  FOREIGN KEY (recorded_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_attendance_user_checkin (user_id, check_in_at),
  INDEX idx_attendance_branch_checkin (branch_id, check_in_at),
  INDEX idx_attendance_status (status, deleted_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS holidays (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  branch_id    INT UNSIGNED DEFAULT NULL,
  title_en     VARCHAR(160) NOT NULL,
  title_ar     VARCHAR(160) NOT NULL,
  reason       ENUM('national_holiday','ramadan','eid','maintenance','unexpected_closure','other') NOT NULL DEFAULT 'other',
  starts_at    DATETIME NOT NULL,
  ends_at      DATETIME NOT NULL,
  extend_memberships BOOLEAN NOT NULL DEFAULT TRUE,
  notify_customers   BOOLEAN NOT NULL DEFAULT TRUE,
  status       ENUM('scheduled','active','completed','cancelled') NOT NULL DEFAULT 'scheduled',
  created_by   INT UNSIGNED DEFAULT NULL,
  updated_by   INT UNSIGNED DEFAULT NULL,
  deleted_at   DATETIME DEFAULT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_holidays_branch_dates (branch_id, starts_at, ends_at),
  INDEX idx_holidays_status_dates (status, starts_at, ends_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS membership_freezes (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  branch_id     INT UNSIGNED DEFAULT 1,
  membership_id INT UNSIGNED NOT NULL,
  user_id       INT UNSIGNED NOT NULL,
  holiday_id    BIGINT UNSIGNED DEFAULT NULL,
  freeze_type   ENUM('individual','global') NOT NULL DEFAULT 'individual',
  reason        VARCHAR(255) NOT NULL,
  starts_on     DATE NOT NULL,
  ends_on       DATE NOT NULL,
  extension_days INT UNSIGNED NOT NULL DEFAULT 0,
  status        ENUM('scheduled','active','completed','cancelled') NOT NULL DEFAULT 'scheduled',
  approved_by   INT UNSIGNED DEFAULT NULL,
  created_by    INT UNSIGNED DEFAULT NULL,
  updated_by    INT UNSIGNED DEFAULT NULL,
  deleted_at    DATETIME DEFAULT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (holiday_id) REFERENCES holidays(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_membership_freezes_membership (membership_id, status),
  INDEX idx_membership_freezes_branch_dates (branch_id, starts_on, ends_on)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS subscription_extensions (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  branch_id     INT UNSIGNED DEFAULT 1,
  membership_id INT UNSIGNED NOT NULL,
  user_id       INT UNSIGNED NOT NULL,
  days          INT UNSIGNED NOT NULL,
  source_type   VARCHAR(80) NOT NULL DEFAULT 'manual',
  source_id     BIGINT UNSIGNED DEFAULT NULL,
  reason        VARCHAR(255) NOT NULL,
  applied_by    INT UNSIGNED DEFAULT NULL,
  created_by    INT UNSIGNED DEFAULT NULL,
  updated_by    INT UNSIGNED DEFAULT NULL,
  deleted_at    DATETIME DEFAULT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (applied_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_subscription_extensions_membership (membership_id, created_at),
  INDEX idx_subscription_extensions_source (source_type, source_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS coupons (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code          VARCHAR(80) NOT NULL UNIQUE,
  title         VARCHAR(160) NOT NULL,
  discount_type ENUM('fixed','percent') NOT NULL DEFAULT 'fixed',
  discount_value DECIMAL(12,2) NOT NULL DEFAULT 0,
  starts_at     DATETIME DEFAULT NULL,
  expires_at    DATETIME DEFAULT NULL,
  usage_limit   INT UNSIGNED DEFAULT NULL,
  used_count    INT UNSIGNED NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  metadata      JSON DEFAULT NULL,
  created_by    INT UNSIGNED DEFAULT NULL,
  updated_by    INT UNSIGNED DEFAULT NULL,
  deleted_at    DATETIME DEFAULT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_coupons_active_dates (is_active, starts_at, expires_at, deleted_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS discounts (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(160) NOT NULL,
  discount_type ENUM('fixed','percent') NOT NULL DEFAULT 'fixed',
  discount_value DECIMAL(12,2) NOT NULL DEFAULT 0,
  scope         ENUM('invoice','membership','plan','customer') NOT NULL DEFAULT 'invoice',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    INT UNSIGNED DEFAULT NULL,
  updated_by    INT UNSIGNED DEFAULT NULL,
  deleted_at    DATETIME DEFAULT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_discounts_scope_active (scope, is_active, deleted_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS promotions (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  branch_id   INT UNSIGNED DEFAULT NULL,
  title_en    VARCHAR(160) NOT NULL,
  title_ar    VARCHAR(160) NOT NULL,
  body_en     TEXT,
  body_ar     TEXT,
  channel     ENUM('website','email','sms','whatsapp','push','all') NOT NULL DEFAULT 'all',
  starts_at   DATETIME DEFAULT NULL,
  ends_at     DATETIME DEFAULT NULL,
  status      ENUM('draft','scheduled','active','completed','cancelled') NOT NULL DEFAULT 'draft',
  created_by  INT UNSIGNED DEFAULT NULL,
  updated_by  INT UNSIGNED DEFAULT NULL,
  deleted_at  DATETIME DEFAULT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_promotions_status_dates (status, starts_at, ends_at),
  INDEX idx_promotions_branch_status (branch_id, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS documents (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  branch_id       INT UNSIGNED DEFAULT 1,
  owner_type      ENUM('customer','employee','invoice','expense','membership','system') NOT NULL,
  owner_id        BIGINT UNSIGNED NOT NULL,
  category        ENUM('document','medical','contract','certificate','invoice','receipt','image','zip','other') NOT NULL DEFAULT 'document',
  original_name   VARCHAR(255) NOT NULL,
  stored_name     VARCHAR(255) NOT NULL,
  storage_path    VARCHAR(500) NOT NULL,
  mime_type       VARCHAR(120) NOT NULL,
  file_size       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  checksum        CHAR(64) DEFAULT NULL,
  thumbnail_path  VARCHAR(500) DEFAULT NULL,
  visibility      ENUM('private','staff','customer') NOT NULL DEFAULT 'private',
  status          ENUM('pending','available','quarantined','deleted') NOT NULL DEFAULT 'available',
  uploaded_by     INT UNSIGNED DEFAULT NULL,
  created_by      INT UNSIGNED DEFAULT NULL,
  updated_by      INT UNSIGNED DEFAULT NULL,
  deleted_at      DATETIME DEFAULT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (uploaded_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_documents_owner (owner_type, owner_id, deleted_at),
  INDEX idx_documents_branch_category (branch_id, category, status)
) ENGINE=InnoDB;

ALTER TABLE expenses
  ADD CONSTRAINT fk_expenses_attachment_document FOREIGN KEY (attachment_document_id) REFERENCES documents(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS report_cache (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  report_key  VARCHAR(120) NOT NULL,
  branch_id   INT UNSIGNED DEFAULT NULL,
  parameters  JSON DEFAULT NULL,
  payload     JSON NOT NULL,
  expires_at  DATETIME NOT NULL,
  created_by  INT UNSIGNED DEFAULT NULL,
  updated_by  INT UNSIGNED DEFAULT NULL,
  deleted_at  DATETIME DEFAULT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_report_cache_key_branch (report_key, branch_id),
  INDEX idx_report_cache_expires (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ai_logs (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  branch_id   INT UNSIGNED DEFAULT NULL,
  admin_user_id INT UNSIGNED DEFAULT NULL,
  prompt      TEXT NOT NULL,
  intent      VARCHAR(120) DEFAULT '',
  response    JSON DEFAULT NULL,
  status      ENUM('success','failed') NOT NULL DEFAULT 'success',
  created_by  INT UNSIGNED DEFAULT NULL,
  updated_by  INT UNSIGNED DEFAULT NULL,
  deleted_at  DATETIME DEFAULT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_ai_logs_admin_created (admin_user_id, created_at),
  INDEX idx_ai_logs_intent_created (intent, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ai_recommendations (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  branch_id   INT UNSIGNED DEFAULT NULL,
  title       VARCHAR(180) NOT NULL,
  body        TEXT NOT NULL,
  category    ENUM('sales','marketing','retention','operations','finance','general') NOT NULL DEFAULT 'general',
  priority    ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
  status      ENUM('open','accepted','dismissed','done') NOT NULL DEFAULT 'open',
  source_log_id BIGINT UNSIGNED DEFAULT NULL,
  created_by  INT UNSIGNED DEFAULT NULL,
  updated_by  INT UNSIGNED DEFAULT NULL,
  deleted_at  DATETIME DEFAULT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (source_log_id) REFERENCES ai_logs(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_ai_recommendations_status_priority (status, priority, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS backup_records (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  filename    VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  size_bytes  BIGINT UNSIGNED DEFAULT 0,
  checksum    CHAR(64) DEFAULT NULL,
  status      ENUM('created','failed','restored','deleted') NOT NULL DEFAULT 'created',
  created_by  INT UNSIGNED DEFAULT NULL,
  updated_by  INT UNSIGNED DEFAULT NULL,
  deleted_at  DATETIME DEFAULT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_backup_records_status_created (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS system_logs (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  level       ENUM('debug','info','warning','error','critical') NOT NULL DEFAULT 'info',
  service     VARCHAR(120) NOT NULL DEFAULT 'app',
  message     VARCHAR(500) NOT NULL,
  context     JSON DEFAULT NULL,
  created_by  INT UNSIGNED DEFAULT NULL,
  updated_by  INT UNSIGNED DEFAULT NULL,
  deleted_at  DATETIME DEFAULT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_system_logs_level_created (level, created_at),
  INDEX idx_system_logs_service_created (service, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS job_queue (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  queue_name  VARCHAR(80) NOT NULL DEFAULT 'default',
  job_type    VARCHAR(120) NOT NULL,
  payload     JSON NOT NULL,
  status      ENUM('pending','processing','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
  attempts    INT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at  DATETIME DEFAULT NULL,
  completed_at DATETIME DEFAULT NULL,
  failed_at   DATETIME DEFAULT NULL,
  last_error  TEXT,
  created_by  INT UNSIGNED DEFAULT NULL,
  updated_by  INT UNSIGNED DEFAULT NULL,
  deleted_at  DATETIME DEFAULT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_job_queue_ready (queue_name, status, available_at),
  INDEX idx_job_queue_type_status (job_type, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS email_queue (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED DEFAULT NULL,
  to_email    VARCHAR(190) NOT NULL,
  subject     VARCHAR(255) NOT NULL,
  body        TEXT NOT NULL,
  status      ENUM('pending','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
  attempts    INT UNSIGNED NOT NULL DEFAULT 0,
  scheduled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sent_at     DATETIME DEFAULT NULL,
  last_error  TEXT,
  created_by  INT UNSIGNED DEFAULT NULL,
  updated_by  INT UNSIGNED DEFAULT NULL,
  deleted_at  DATETIME DEFAULT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_email_queue_status_schedule (status, scheduled_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS whatsapp_queue (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED DEFAULT NULL,
  phone       VARCHAR(40) NOT NULL,
  message     TEXT NOT NULL,
  status      ENUM('pending','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
  attempts    INT UNSIGNED NOT NULL DEFAULT 0,
  scheduled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sent_at     DATETIME DEFAULT NULL,
  last_error  TEXT,
  created_by  INT UNSIGNED DEFAULT NULL,
  updated_by  INT UNSIGNED DEFAULT NULL,
  deleted_at  DATETIME DEFAULT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_whatsapp_queue_status_schedule (status, scheduled_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sms_queue (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED DEFAULT NULL,
  phone       VARCHAR(40) NOT NULL,
  message     TEXT NOT NULL,
  status      ENUM('pending','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
  attempts    INT UNSIGNED NOT NULL DEFAULT 0,
  scheduled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sent_at     DATETIME DEFAULT NULL,
  last_error  TEXT,
  created_by  INT UNSIGNED DEFAULT NULL,
  updated_by  INT UNSIGNED DEFAULT NULL,
  deleted_at  DATETIME DEFAULT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_sms_queue_status_schedule (status, scheduled_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS push_notifications (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED DEFAULT NULL,
  title       VARCHAR(200) NOT NULL,
  body        TEXT NOT NULL,
  payload     JSON DEFAULT NULL,
  status      ENUM('pending','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
  attempts    INT UNSIGNED NOT NULL DEFAULT 0,
  scheduled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sent_at     DATETIME DEFAULT NULL,
  last_error  TEXT,
  created_by  INT UNSIGNED DEFAULT NULL,
  updated_by  INT UNSIGNED DEFAULT NULL,
  deleted_at  DATETIME DEFAULT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_push_notifications_status_schedule (status, scheduled_at)
) ENGINE=InnoDB;

ALTER TABLE logs
  ADD COLUMN branch_id INT UNSIGNED DEFAULT NULL AFTER id,
  ADD COLUMN actor_role VARCHAR(80) DEFAULT NULL AFTER actor_id,
  ADD COLUMN description VARCHAR(500) DEFAULT '' AFTER action,
  ADD COLUMN old_value JSON DEFAULT NULL AFTER meta,
  ADD COLUMN new_value JSON DEFAULT NULL AFTER old_value,
  ADD COLUMN user_agent VARCHAR(500) DEFAULT NULL AFTER ip_address,
  ADD COLUMN reason VARCHAR(255) DEFAULT NULL AFTER user_agent,
  ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at,
  ADD CONSTRAINT fk_logs_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  ADD INDEX idx_logs_branch_created (branch_id, created_at),
  ADD INDEX idx_logs_target (target_table, target_id);
