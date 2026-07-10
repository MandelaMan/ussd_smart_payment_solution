CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_type ENUM(
    'payment_received',
    'payment_failed',
    'zoho_invoice_created',
    'zoho_invoice_updated',
    'zoho_invoice_failed',
    'tisp_reconnected',
    'tisp_reconnect_failed'
  ) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message VARCHAR(500) NULL,
  source ENUM('mpesa', 'zoho', 'tisp') NOT NULL,
  status ENUM('success', 'failed', 'pending') NOT NULL DEFAULT 'success',
  customer_ref VARCHAR(191) NULL,
  amount DECIMAL(12, 2) NULL,
  reference_id VARCHAR(191) NULL,
  payment_transaction_id BIGINT UNSIGNED NULL,
  metadata JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_activity_created (created_at),
  KEY idx_activity_type (event_type),
  KEY idx_activity_source (source),
  CONSTRAINT fk_activity_payment_tx
    FOREIGN KEY (payment_transaction_id) REFERENCES payment_transactions(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
