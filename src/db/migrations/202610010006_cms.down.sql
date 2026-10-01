-- Reverses 202610010006_cms.up.sql.
DELETE FROM settings WHERE key_name IN ('contact_email', 'address_en', 'address_ar', 'whatsapp_message_en', 'whatsapp_message_ar',
  'instagram_url', 'x_url', 'tiktok_url', 'snapchat_url', 'meta_title_en', 'meta_title_ar', 'meta_description_en', 'meta_description_ar', 'favicon_url');
ALTER TABLE slider_images DROP COLUMN starts_at, DROP COLUMN ends_at;
ALTER TABLE faqs DROP FOREIGN KEY fk_faqs_branch;
ALTER TABLE faqs DROP INDEX idx_faqs_branch_active, DROP COLUMN branch_id, DROP COLUMN deleted_at;
