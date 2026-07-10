ALTER TABLE customers
  ADD COLUMN zoho_invoice_seq INT UNSIGNED NOT NULL DEFAULT 0 AFTER zoho_billing_error;
