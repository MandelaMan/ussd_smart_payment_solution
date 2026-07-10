CREATE TABLE IF NOT EXISTS pending_upgrades (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id INT UNSIGNED NOT NULL,
  target_product_id INT UNSIGNED NOT NULL,
  payment_method ENUM('invoice', 'stk') NOT NULL,
  top_up_amount DECIMAL(12, 2) NOT NULL,
  status ENUM('payment_pending', 'completed', 'cancelled', 'failed') NOT NULL DEFAULT 'payment_pending',
  zoho_invoice_id VARCHAR(64) NULL,
  zoho_invoice_number VARCHAR(64) NULL,
  mpesa_checkout_request_id VARCHAR(128) NULL,
  quote_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_pending_customer (customer_id),
  KEY idx_pending_status (status),
  KEY idx_pending_invoice (zoho_invoice_id),
  KEY idx_pending_checkout (mpesa_checkout_request_id),
  CONSTRAINT fk_pending_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_pending_product FOREIGN KEY (target_product_id) REFERENCES products (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE customers
  ADD COLUMN upgrade_payment_status ENUM('none', 'payment_pending') NOT NULL DEFAULT 'none' AFTER status;

ALTER TABLE activity_logs
  MODIFY event_type ENUM(
    'payment_received',
    'payment_failed',
    'zoho_invoice_created',
    'zoho_invoice_updated',
    'zoho_invoice_failed',
    'tisp_reconnected',
    'tisp_reconnect_failed',
    'customer_created',
    'customer_created_tisp_failed',
    'customer_cancelled',
    'customer_upgraded',
    'customer_downgraded',
    'customer_apartment_switched',
    'upgrade_payment_pending',
    'upgrade_payment_completed'
  ) NOT NULL;
