-- Local store for customer email conversations (outbound from WeCare + mirrored metadata)

CREATE TABLE IF NOT EXISTS customer_email_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id INT UNSIGNED NOT NULL,
  direction ENUM('outbound', 'inbound') NOT NULL DEFAULT 'outbound',
  from_address VARCHAR(255) NOT NULL,
  to_address VARCHAR(255) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  body_html MEDIUMTEXT NULL,
  body_text TEXT NULL,
  attachment_names JSON NULL,
  zoho_message_id VARCHAR(128) NULL,
  status ENUM('sent', 'failed', 'received') NOT NULL DEFAULT 'sent',
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cem_customer_created (customer_id, created_at),
  KEY idx_cem_to_address (to_address),
  KEY idx_cem_zoho_message (zoho_message_id),
  CONSTRAINT fk_cem_customer
    FOREIGN KEY (customer_id) REFERENCES customers (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
