-- Billing address for Zoho Books contact sync
ALTER TABLE customers
  ADD COLUMN billing_attention VARCHAR(191) NULL AFTER email,
  ADD COLUMN billing_address VARCHAR(255) NULL AFTER billing_attention,
  ADD COLUMN billing_street2 VARCHAR(255) NULL AFTER billing_address,
  ADD COLUMN billing_city VARCHAR(100) NULL AFTER billing_street2,
  ADD COLUMN billing_state VARCHAR(100) NULL AFTER billing_city,
  ADD COLUMN billing_zip VARCHAR(32) NULL AFTER billing_state,
  ADD COLUMN billing_country VARCHAR(100) NULL AFTER billing_zip;
