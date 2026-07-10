CREATE TABLE IF NOT EXISTS integration_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source ENUM('zoho', 'tisp') NOT NULL,
  payment_transaction_id BIGINT UNSIGNED NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  customer_no VARCHAR(191) NULL,
  amount DECIMAL(12, 2) NULL,
  reference_id VARCHAR(191) NULL,
  outcome VARCHAR(64) NULL,
  channel VARCHAR(32) NULL,
  raw_payload JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_integration_source (source),
  KEY idx_integration_payment_tx (payment_transaction_id),
  KEY idx_integration_status (status),
  KEY idx_integration_created_at (created_at),
  CONSTRAINT fk_integration_payment_tx
    FOREIGN KEY (payment_transaction_id) REFERENCES payment_transactions(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
