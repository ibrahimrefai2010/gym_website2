-- Reverses 202610010004_import_jobs.up.sql (the member_code/card_token
-- backfill is intentionally kept: removing codes would break cards).
DROP TABLE IF EXISTS import_jobs;
