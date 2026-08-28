CREATE DATABASE IF NOT EXISTS muscle_fitness
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE muscle_fitness;

CREATE TABLE IF NOT EXISTS users (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name         VARCHAR(160) NOT NULL,
  email             VARCHAR(190) NOT NULL UNIQUE,
  phone             VARCHAR(40) NOT NULL UNIQUE,
  password_hash     VARCHAR(255) NOT NULL,
  status            ENUM('active','inactive','suspended') NOT NULL DEFAULT 'active',
  email_verified_at DATETIME,
  phone_verified_at DATETIME,
  deleted_at        DATETIME DEFAULT NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_status_deleted (status, deleted_at),
  INDEX idx_users_email_deleted (email, deleted_at),
  INDEX idx_users_phone_deleted (phone, deleted_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name     VARCHAR(160) NOT NULL,
  email         VARCHAR(190) NOT NULL UNIQUE,
  phone         VARCHAR(40),
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('super_admin','admin','manager','staff') NOT NULL DEFAULT 'staff',
  status        ENUM('active','inactive','suspended') NOT NULL DEFAULT 'active',
  deleted_at    DATETIME DEFAULT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_admin_role_status_deleted (role, status, deleted_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS plans (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name_ar        VARCHAR(120) NOT NULL,
  name_en        VARCHAR(120) NOT NULL,
  description_ar TEXT NOT NULL,
  description_en TEXT NOT NULL,
  duration_days  INT UNSIGNED NOT NULL,
  bonus_days     INT UNSIGNED NOT NULL DEFAULT 0,
  price          DECIMAL(10,2) NOT NULL,
  original_price DECIMAL(10,2) NOT NULL,
  is_active      BOOLEAN DEFAULT TRUE,
  is_featured    BOOLEAN DEFAULT FALSE,
  sort_order     INT NOT NULL DEFAULT 0,
  deleted_at     DATETIME DEFAULT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_plans_public (is_active, deleted_at, sort_order)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS offers (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title_ar       VARCHAR(160) NOT NULL,
  title_en       VARCHAR(160) NOT NULL,
  body_ar        TEXT NOT NULL,
  body_en        TEXT NOT NULL,
  image_url      VARCHAR(255),
  discount_value DECIMAL(10,2) DEFAULT 0,
  badge_ar       VARCHAR(40) DEFAULT '',
  badge_en       VARCHAR(40) DEFAULT '',
  button_text_ar VARCHAR(80),
  button_text_en VARCHAR(80),
  button_url     VARCHAR(255),
  starts_at      DATETIME,
  expires_at     DATETIME NOT NULL,
  is_active      BOOLEAN DEFAULT TRUE,
  sort_order     INT NOT NULL DEFAULT 0,
  deleted_at     DATETIME DEFAULT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_offers_public (expires_at, is_active, deleted_at, sort_order)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS memberships (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      INT UNSIGNED NOT NULL,
  plan_id      INT UNSIGNED NOT NULL,
  status       ENUM('pending','active','expired','cancelled') NOT NULL DEFAULT 'pending',
  start_date   DATE,
  end_date     DATE,
  activated_by INT UNSIGNED,
  cancelled_at DATETIME,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES plans(id),
  FOREIGN KEY (activated_by) REFERENCES admin_users(id),
  INDEX idx_memberships_user_status (user_id, status),
  INDEX idx_memberships_end_status (end_date, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id            INT UNSIGNED NOT NULL,
  membership_id      INT UNSIGNED,
  provider           ENUM('manual','stripe','tabby','tamara') NOT NULL DEFAULT 'manual',
  payment_method     ENUM('cash','card','manual','stripe','tabby','tamara') NOT NULL DEFAULT 'manual',
  provider_reference VARCHAR(190),
  transaction_id     VARCHAR(190),
  amount             DECIMAL(10,2) NOT NULL,
  currency           CHAR(3) NOT NULL DEFAULT 'SAR',
  status             ENUM('pending','completed','failed','refunded','cancelled') NOT NULL DEFAULT 'pending',
  completed_at       DATETIME,
  completed_by       INT UNSIGNED,
  raw_payload        JSON,
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE SET NULL,
  FOREIGN KEY (completed_by) REFERENCES admin_users(id),
  INDEX idx_payments_status_created (status, created_at),
  INDEX idx_payments_membership (membership_id),
  INDEX idx_payments_transaction (transaction_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payment_events (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  provider     ENUM('stripe','tabby','tamara','manual') NOT NULL,
  event_id     VARCHAR(190) NOT NULL,
  event_type   VARCHAR(160) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  raw_payload  JSON,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payment_events_provider_event (provider, event_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS otp_tokens (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  identifier   VARCHAR(150) NOT NULL,
  token_hash   VARCHAR(255) NOT NULL,
  purpose      ENUM('reset_password','verify_email','verify_phone') NOT NULL,
  expires_at   DATETIME NOT NULL,
  used_at      DATETIME,
  ip_address   VARCHAR(45),
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_identifier (identifier),
  INDEX idx_expires (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at    DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_password_reset_user (user_id),
  INDEX idx_password_reset_expires (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id        INT UNSIGNED,
  admin_user_id  INT UNSIGNED,
  token_hash     VARCHAR(255) NOT NULL UNIQUE,
  expires_at     DATETIME NOT NULL,
  revoked_at     DATETIME,
  ip_address     VARCHAR(45),
  user_agent     VARCHAR(500),
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
  INDEX idx_refresh_user (user_id, revoked_at),
  INDEX idx_refresh_admin (admin_user_id, revoked_at),
  INDEX idx_refresh_expires (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  type       VARCHAR(50) NOT NULL,
  title_ar   VARCHAR(200),
  title_en   VARCHAR(200),
  body_ar    TEXT,
  body_en    TEXT,
  is_read    BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notifications_user_read (user_id, is_read),
  INDEX idx_notifications_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS settings (
  key_name   VARCHAR(100) PRIMARY KEY,
  value      TEXT,
  type       ENUM('string','number','boolean','json') DEFAULT 'string',
  label_ar   VARCHAR(200),
  label_en   VARCHAR(200),
  updated_by INT UNSIGNED,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by) REFERENCES admin_users(id)
) ENGINE=InnoDB;

INSERT INTO settings (key_name, value, type, label_en, label_ar) VALUES
('gym_name_en',                  'Muscle and Fitness Center',                                           'string', 'Gym name (English)',       'اسم الصالة (إنجليزي)'),
('gym_name_ar',                  'مركز بناء ولياقة الرياضي',                                            'string', 'Gym name (Arabic)',        'اسم الصالة (عربي)'),
('whatsapp_number',              '966569919944',                                                        'string', 'WhatsApp number',          'رقم واتساب'),
('phone_number',                 '+966569919944',                                                       'string', 'Phone number',             'رقم الهاتف'),
('google_maps_url',              'https://maps.google.com/?q=Hyper+Panda+Roundabout+Jizan+Saudi+Arabia','string', 'Google Maps URL',          'رابط الخريطة'),
('working_hours_ar',             'السبت - الخميس: 6ص - 11م  |  الجمعة: 4م - 11م',                     'string', 'Working hours (AR)',       'ساعات العمل (عربي)'),
('working_hours_en',             'Sat - Thu: 6AM - 11PM  |  Fri: 4PM - 11PM',                          'string', 'Working hours (EN)',       'Working hours (English)'),
('membership_activation_mode',   'manual',                                                              'string', 'Activation mode (auto/manual)', 'طريقة التفعيل')
ON DUPLICATE KEY UPDATE value = VALUES(value), type = VALUES(type), label_en = VALUES(label_en), label_ar = VALUES(label_ar);

CREATE TABLE IF NOT EXISTS logs (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_type   ENUM('user','admin') NOT NULL,
  actor_id     INT UNSIGNED NOT NULL,
  action       VARCHAR(100) NOT NULL,
  target_table VARCHAR(100),
  target_id    INT UNSIGNED,
  meta         JSON,
  ip_address   VARCHAR(45),
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_actor (actor_type, actor_id),
  INDEX idx_action (action),
  INDEX idx_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS messages (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(160) NOT NULL,
  email      VARCHAR(190) NOT NULL,
  phone      VARCHAR(40) NOT NULL,
  subject    VARCHAR(180) NOT NULL,
  message    TEXT NOT NULL,
  status     ENUM('unread','read','archived') NOT NULL DEFAULT 'unread',
  ip_address VARCHAR(45),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_messages_status_created (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS slider_images (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  image_url          VARCHAR(255) NOT NULL,
  fallback_image_url VARCHAR(255),
  title_en           VARCHAR(160) NOT NULL,
  title_ar           VARCHAR(160) NOT NULL,
  body_en            TEXT NOT NULL,
  body_ar            TEXT NOT NULL,
  sort_order         INT NOT NULL DEFAULT 0,
  is_active          BOOLEAN DEFAULT TRUE,
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_slider_active_sort (is_active, sort_order)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS faqs (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  question_en VARCHAR(220) NOT NULL,
  question_ar VARCHAR(220) NOT NULL,
  answer_en   TEXT NOT NULL,
  answer_ar   TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS homepage_text (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  section_key VARCHAR(80) NOT NULL UNIQUE,
  title_en    VARCHAR(220) NOT NULL,
  title_ar    VARCHAR(220) NOT NULL,
  body_en     TEXT NOT NULL,
  body_ar     TEXT NOT NULL,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT INTO plans (name_ar, name_en, description_ar, description_en, duration_days, bonus_days, price, original_price, is_active, is_featured, sort_order) VALUES
('شهر واحد',   '1 Month + 7 Days Extra', 'دخول مناسب للتدريب المنتظم باستقلالية.',       'Access for consistent independent training.',          30,  7, 349,  550,  1, 0, 1),
('3 اشهر',     '3 Months',               'عضوية بإشراف تدريبي لتحقيق تقدم واضح.',        'Coaching-led membership for measurable progress.',     90,  0, 849,  1656, 1, 1, 2),
('6 اشهر',     '6 Months',               'إشراف شخصي وخدمة تدريب خاصة.',                 'High-touch coaching and private training support.',    180, 0, 1399, 2651, 1, 0, 3),
('12 اشهر',    '12 Months',              'إشراف شخصي وخدمة تدريب خاصة.',                 'High-touch coaching and private training support.',    365, 0, 1849, 5037, 1, 0, 4);
