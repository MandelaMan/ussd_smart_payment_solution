-- Persistent integration snapshots (Zoho contact, payments, recurring; TISP status)
-- Invoices are stored in zoho_customer_invoices (018). These tables avoid repeat API calls.

CREATE TABLE IF NOT EXISTS zoho_customer_contacts (
  customer_id INT UNSIGNED NOT NULL PRIMARY KEY,
  zoho_contact_id VARCHAR(64) NOT NULL,
  company_name VARCHAR(128) NULL,
  email VARCHAR(255) NULL,
  credit_balance DECIMAL(12, 2) NULL,
  raw_json JSON NULL,
  synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_zoho_contacts_contact (zoho_contact_id),
  INDEX idx_zoho_contacts_synced (synced_at)
);

CREATE TABLE IF NOT EXISTS zoho_customer_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id INT UNSIGNED NOT NULL,
  payment_id VARCHAR(64) NOT NULL,
  payment_date DATE NULL,
  amount DECIMAL(12, 2) NULL,
  reference_number VARCHAR(128) NULL,
  invoice_number VARCHAR(64) NULL,
  raw_json JSON NULL,
  synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_zoho_customer_payment (customer_id, payment_id),
  INDEX idx_zoho_payments_customer (customer_id),
  INDEX idx_zoho_payments_synced (synced_at)
);

CREATE TABLE IF NOT EXISTS zoho_recurring_invoices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id INT UNSIGNED NOT NULL,
  recurring_invoice_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NULL,
  next_invoice_date DATE NULL,
  last_sent_date DATE NULL,
  raw_json JSON NULL,
  synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_zoho_recurring (customer_id, recurring_invoice_id),
  INDEX idx_zoho_recurring_customer (customer_id)
);

CREATE TABLE IF NOT EXISTS tisp_customer_snapshots (
  customer_id INT UNSIGNED NOT NULL PRIMARY KEY,
  subscription_status VARCHAR(64) NULL,
  due_date VARCHAR(128) NULL,
  package_label VARCHAR(255) NULL,
  monthly_amount DECIMAL(12, 2) NULL,
  raw_json JSON NULL,
  synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tisp_snapshots_synced (synced_at)
);
