-- Trial period: skip signup invoice; first bill via recurring profile after 30 days.
ALTER TABLE customers
  ADD COLUMN trial_period_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER zoho_signup_invoice_emailed_at,
  ADD COLUMN trial_ends_at DATE NULL AFTER trial_period_enabled;
