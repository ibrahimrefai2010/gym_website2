DROP TABLE IF EXISTS notification_preferences;

ALTER TABLE notifications
  DROP COLUMN read_at;

ALTER TABLE users
  DROP INDEX uq_users_member_code,
  DROP INDEX uq_users_card_token,
  DROP COLUMN member_code,
  DROP COLUMN card_token;
