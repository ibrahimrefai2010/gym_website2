-- Part 2: Moyasar hosted-checkout payments.
--
-- One `payments` row per checkout attempt. The row is created 'pending' when
-- the member starts checkout (provider_reference = the Moyasar invoice id)
-- and moves to completed / failed / cancelled exactly once, under a row lock
-- (see paymentService.finalizeMoyasarPayment). These columns carry the
-- checkout context the finalizer needs without re-deriving it:
--   plan_id        -- the plan being bought / renewed onto (for renewals the
--                     membership_id points at the *existing* active
--                     membership being extended, so the plan can differ).
--   purpose        -- 'new' (pending membership created at checkout) or
--                     'renewal' (extend the active membership on success).
--   checkout_url   -- Moyasar hosted checkout page, so a member can resume.
--   failure_reason -- provider message on failed/cancelled attempts.
--   expires_at     -- when the Moyasar invoice expires; the reconcile job
--                     closes attempts that were abandoned past this point.

ALTER TABLE payments
  ADD COLUMN plan_id INT UNSIGNED DEFAULT NULL AFTER membership_id,
  ADD COLUMN purpose ENUM('new','renewal') DEFAULT NULL AFTER plan_id,
  ADD COLUMN checkout_url VARCHAR(500) DEFAULT NULL AFTER transaction_id,
  ADD COLUMN failure_reason VARCHAR(255) DEFAULT NULL AFTER status,
  ADD COLUMN expires_at DATETIME DEFAULT NULL AFTER failure_reason,
  ADD CONSTRAINT fk_payments_plan FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL,
  ADD INDEX idx_payments_provider_reference (provider, provider_reference),
  ADD INDEX idx_payments_provider_status (provider, status, created_at);

-- Failed online payments auto-create a follow-up task (taskService
-- createTaskForFailedPayment), gated per branch like the other two triggers.
INSERT INTO settings (branch_id, key_name, value, type, label_en, label_ar)
SELECT b.id, 'task_autogen_failed_payments', 'true', 'boolean',
       'Auto-create tasks for failed online payments', 'إنشاء مهام تلقائية لعمليات الدفع الإلكتروني الفاشلة'
FROM branches b
ON DUPLICATE KEY UPDATE key_name = VALUES(key_name);
