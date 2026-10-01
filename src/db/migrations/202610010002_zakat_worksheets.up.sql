-- Part 2 §2.0.6: Zakat helper worksheet (internal accountant tool -- never
-- shown on customer invoices).
--
-- The worksheet is a data-collection sheet, not a Zakat calculation: the
-- system pre-fills what it knows (revenue, VAT collected, expenses, open
-- receivables for the Hijri year) and the accountant records the balances
-- it cannot know here. One row per (branch, Hijri year) because the two
-- branches are separate VAT/CR registrations (owner decision 2026-09-18), and the
-- consolidated view sums the branch rows.

CREATE TABLE IF NOT EXISTS zakat_worksheets (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  branch_id          INT UNSIGNED NOT NULL,
  hijri_year         SMALLINT UNSIGNED NOT NULL,
  cash_on_hand       DECIMAL(14,2) DEFAULT NULL,
  bank_balances      DECIMAL(14,2) DEFAULT NULL,
  receivables        DECIMAL(14,2) DEFAULT NULL,
  inventory          DECIMAL(14,2) DEFAULT NULL,
  prepaid_expenses   DECIMAL(14,2) DEFAULT NULL,
  current_liabilities DECIMAL(14,2) DEFAULT NULL,
  other_inputs       JSON DEFAULT NULL,
  notes              TEXT,
  updated_by         INT UNSIGNED DEFAULT NULL,
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_zakat_branch_year (branch_id, hijri_year),
  CONSTRAINT fk_zakat_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_zakat_updated_by FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- The Zakat worksheet filters invoices by branch + Hijri year (branch + issue
-- date is already covered by idx_invoices_branch_date_status).
ALTER TABLE invoices
  ADD INDEX idx_invoices_branch_hijri (branch_id, hijri_year, status);
