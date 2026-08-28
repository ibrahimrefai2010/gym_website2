ALTER TABLE users
  ADD COLUMN member_code VARCHAR(20) DEFAULT NULL AFTER phone,
  ADD COLUMN card_token CHAR(32) DEFAULT NULL AFTER member_code,
  ADD UNIQUE KEY uq_users_member_code (member_code),
  ADD UNIQUE KEY uq_users_card_token (card_token);

UPDATE users SET member_code = CONCAT('MFC-', LPAD(id, 6, '0')) WHERE member_code IS NULL;

UPDATE users SET card_token = REPLACE(UUID(), '-', '') WHERE card_token IS NULL;

ALTER TABLE notifications
  ADD COLUMN read_at DATETIME DEFAULT NULL AFTER is_read;

UPDATE notifications SET read_at = created_at WHERE is_read = 1 AND read_at IS NULL;

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id             INT UNSIGNED PRIMARY KEY,
  email_transactional BOOLEAN NOT NULL DEFAULT TRUE,
  sms_transactional   BOOLEAN NOT NULL DEFAULT FALSE,
  email_marketing     BOOLEAN NOT NULL DEFAULT FALSE,
  sms_marketing       BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_marketing  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
