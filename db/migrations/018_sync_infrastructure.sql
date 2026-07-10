-- Background synchronization infrastructure

CREATE TABLE IF NOT EXISTS sync_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  integration VARCHAR(64) NOT NULL,
  job_id VARCHAR(128) NULL,
  status ENUM('queued', 'running', 'completed', 'failed', 'retrying') NOT NULL DEFAULT 'queued',
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  duration_ms INT UNSIGNED NULL,
  records_processed INT UNSIGNED NOT NULL DEFAULT 0,
  records_created INT UNSIGNED NOT NULL DEFAULT 0,
  records_updated INT UNSIGNED NOT NULL DEFAULT 0,
  records_failed INT UNSIGNED NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  last_synced_at DATETIME NULL,
  correlation_id VARCHAR(64) NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sync_jobs_integration_created (integration, created_at DESC),
  INDEX idx_sync_jobs_status (status),
  INDEX idx_sync_jobs_job_id (job_id),
  INDEX idx_sync_jobs_correlation (correlation_id)
);

CREATE TABLE IF NOT EXISTS integration_sync_state (
  integration VARCHAR(64) NOT NULL PRIMARY KEY,
  last_synced_at DATETIME NULL,
  last_success_at DATETIME NULL,
  last_error TEXT NULL,
  sync_cursor JSON NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Zoho invoice cache for incremental invoice sync (per customer)
CREATE TABLE IF NOT EXISTS zoho_customer_invoices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id INT UNSIGNED NOT NULL,
  zoho_contact_id VARCHAR(64) NULL,
  invoice_id VARCHAR(64) NOT NULL,
  invoice_number VARCHAR(64) NULL,
  invoice_date DATE NULL,
  due_date DATE NULL,
  status VARCHAR(32) NULL,
  total DECIMAL(12, 2) NULL,
  balance_due DECIMAL(12, 2) NULL,
  raw_json JSON NULL,
  synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_zoho_customer_invoice (customer_id, invoice_id),
  INDEX idx_zoho_invoices_customer (customer_id),
  INDEX idx_zoho_invoices_status (status),
  INDEX idx_zoho_invoices_synced (synced_at)
);

-- Dashboard summary cache indexes (reconciliation tables created at runtime)
-- Add composite index on reconciliation_customer_cache if table exists
-- (handled in reconciliationStore ensureReconciliationSchema)
