-- Part 2 §2.0.8: content management gaps.
--
-- 1. FAQs: branch_id NULL = shown on every branch's site (shared answers),
--    a branch id = that branch only (e.g. a Women's-branch privacy answer).
--    Only cross-branch admins may edit shared rows.
ALTER TABLE faqs
  ADD COLUMN branch_id INT UNSIGNED DEFAULT NULL AFTER id,
  ADD COLUMN deleted_at DATETIME DEFAULT NULL AFTER is_active,
  ADD CONSTRAINT fk_faqs_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  ADD INDEX idx_faqs_branch_active (branch_id, is_active, sort_order);

-- 2. Slider scheduling (offers already have starts_at / expires_at).
ALTER TABLE slider_images
  ADD COLUMN starts_at DATETIME DEFAULT NULL AFTER is_active,
  ADD COLUMN ends_at DATETIME DEFAULT NULL AFTER starts_at;

-- 3. Branch-scoped contact / social / SEO settings (empty = site default).
INSERT INTO settings (branch_id, key_name, value, type, label_en, label_ar)
SELECT b.id, k.key_name, '', 'string', k.label_en, k.label_ar
FROM branches b
CROSS JOIN (
  SELECT 'contact_email' AS key_name, 'Contact email' AS label_en, 'البريد الإلكتروني للتواصل' AS label_ar
  UNION ALL SELECT 'address_en', 'Address (English)', 'العنوان (إنجليزي)'
  UNION ALL SELECT 'address_ar', 'Address (Arabic)', 'العنوان (عربي)'
  UNION ALL SELECT 'whatsapp_message_en', 'WhatsApp pre-filled message (English)', 'رسالة واتساب الجاهزة (إنجليزي)'
  UNION ALL SELECT 'whatsapp_message_ar', 'WhatsApp pre-filled message (Arabic)', 'رسالة واتساب الجاهزة (عربي)'
  UNION ALL SELECT 'instagram_url', 'Instagram URL', 'رابط إنستغرام'
  UNION ALL SELECT 'x_url', 'X (Twitter) URL', 'رابط إكس'
  UNION ALL SELECT 'tiktok_url', 'TikTok URL', 'رابط تيك توك'
  UNION ALL SELECT 'snapchat_url', 'Snapchat URL', 'رابط سناب شات'
  UNION ALL SELECT 'meta_title_en', 'Page title (English)', 'عنوان الصفحة (إنجليزي)'
  UNION ALL SELECT 'meta_title_ar', 'Page title (Arabic)', 'عنوان الصفحة (عربي)'
  UNION ALL SELECT 'meta_description_en', 'Meta description (English)', 'وصف الصفحة (إنجليزي)'
  UNION ALL SELECT 'meta_description_ar', 'Meta description (Arabic)', 'وصف الصفحة (عربي)'
  UNION ALL SELECT 'favicon_url', 'Favicon URL', 'رابط أيقونة الموقع'
) k
WHERE b.id IS NOT NULL
ON DUPLICATE KEY UPDATE key_name = VALUES(key_name);
