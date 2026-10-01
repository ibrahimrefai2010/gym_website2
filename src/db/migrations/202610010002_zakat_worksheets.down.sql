-- Reverses 202610010002_zakat_worksheets.up.sql.
ALTER TABLE invoices DROP INDEX idx_invoices_branch_hijri;
DROP TABLE IF EXISTS zakat_worksheets;
