ALTER TABLE customers
  ADD COLUMN zoho_signup_invoice_id VARCHAR(64) NULL AFTER zoho_invoice_seq,
  ADD COLUMN zoho_signup_invoice_emailed_at DATETIME NULL AFTER zoho_signup_invoice_id;
