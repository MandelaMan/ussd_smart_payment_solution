-- Billing reconciliation sync runs and audit trail

CREATE TABLE IF NOT EXISTS reconciliation_sync_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  status ENUM('running', 'completed', 'failed') NOT NULL DEFAULT 'running',
  triggered_by VARCHAR(64) NULL,
  user_id INT UNSIGNED NULL,
  customers_scanned INT UNSIGNED NOT NULL DEFAULT 0,
  issues_found INT UNSIGNED NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  metadata JSON NULL,
  INDEX idx_reconciliation_sync_started (started_at DESC)
);

CREATE TABLE IF NOT EXISTS reconciliation_actions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id INT UNSIGNED NULL,
  customer_number VARCHAR(64) NULL,
  action_type VARCHAR(64) NOT NULL,
  previous_value TEXT NULL,
  new_value TEXT NULL,
  reason TEXT NULL,
  user_id INT UNSIGNED NULL,
  user_email VARCHAR(255) NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_reconciliation_actions_customer (customer_id),
  INDEX idx_reconciliation_actions_created (created_at DESC)
);
