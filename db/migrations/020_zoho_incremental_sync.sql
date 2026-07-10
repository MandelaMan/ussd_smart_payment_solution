-- Zoho incremental sync: additional entity tables and sync metadata

ALTER TABLE integration_sync_state
  ADD COLUMN status VARCHAR(32) NULL DEFAULT 'idle' AFTER integration,
  ADD COLUMN last_attempt_at DATETIME NULL AFTER last_synced_at,
  ADD COLUMN records_updated INT UNSIGNED NOT NULL DEFAULT 0 AFTER last_error;

-- Estimates (org-level, linked to customer when resolvable)
CREATE TABLE IF NOT EXISTS zoho_estimates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  zoho_estimate_id VARCHAR(64) NOT NULL,
  zoho_contact_id VARCHAR(64) NULL,
  customer_id INT UNSIGNED NULL,
  estimate_number VARCHAR(64) NULL,
  estimate_date DATE NULL,
  status VARCHAR(32) NULL,
  total DECIMAL(12, 2) NULL,
  zoho_last_modified_time DATETIME NULL,
  sync_status VARCHAR(32) NOT NULL DEFAULT 'synced',
  raw_json JSON NULL,
  synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_zoho_estimate (zoho_estimate_id),
  INDEX idx_zoho_estimates_customer (customer_id),
  INDEX idx_zoho_estimates_contact (zoho_contact_id),
  INDEX idx_zoho_estimates_modified (zoho_last_modified_time)
);

-- Credit notes
CREATE TABLE IF NOT EXISTS zoho_credit_notes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  zoho_credit_note_id VARCHAR(64) NOT NULL,
  zoho_contact_id VARCHAR(64) NULL,
  customer_id INT UNSIGNED NULL,
  credit_note_number VARCHAR(64) NULL,
  credit_note_date DATE NULL,
  status VARCHAR(32) NULL,
  total DECIMAL(12, 2) NULL,
  balance DECIMAL(12, 2) NULL,
  zoho_last_modified_time DATETIME NULL,
  sync_status VARCHAR(32) NOT NULL DEFAULT 'synced',
  raw_json JSON NULL,
  synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_zoho_credit_note (zoho_credit_note_id),
  INDEX idx_zoho_credit_notes_customer (customer_id),
  INDEX idx_zoho_credit_notes_contact (zoho_contact_id),
  INDEX idx_zoho_credit_notes_modified (zoho_last_modified_time)
);

-- Zoho webhook event log (for monitoring and retries)
CREATE TABLE IF NOT EXISTS zoho_webhook_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  zoho_record_id VARCHAR(64) NULL,
  payload JSON NULL,
  status ENUM('received', 'processed', 'failed', 'ignored') NOT NULL DEFAULT 'received',
  error_message TEXT NULL,
  api_calls_used INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  INDEX idx_zoho_webhook_events_type (event_type, created_at DESC),
  INDEX idx_zoho_webhook_events_status (status, created_at DESC)
);

-- Optional metadata on existing snapshot tables
ALTER TABLE zoho_customer_contacts
  ADD COLUMN zoho_last_modified_time DATETIME NULL AFTER raw_json,
  ADD COLUMN sync_status VARCHAR(32) NOT NULL DEFAULT 'synced' AFTER zoho_last_modified_time;

ALTER TABLE zoho_customer_invoices
  ADD COLUMN zoho_last_modified_time DATETIME NULL AFTER raw_json,
  ADD COLUMN sync_status VARCHAR(32) NOT NULL DEFAULT 'synced' AFTER zoho_last_modified_time;

ALTER TABLE zoho_customer_payments
  ADD COLUMN zoho_last_modified_time DATETIME NULL AFTER raw_json,
  ADD COLUMN sync_status VARCHAR(32) NOT NULL DEFAULT 'synced' AFTER zoho_last_modified_time;

ALTER TABLE zoho_recurring_invoices
  ADD COLUMN zoho_last_modified_time DATETIME NULL AFTER raw_json,
  ADD COLUMN sync_status VARCHAR(32) NOT NULL DEFAULT 'synced' AFTER zoho_last_modified_time;
