-- Lead email conversations (prospect outreach via Zoho Mail)

ALTER TABLE leads
  MODIFY COLUMN source ENUM('whatsapp', 'web', 'embed', 'email') NOT NULL;

CREATE TABLE IF NOT EXISTS lead_email_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_id INT UNSIGNED NOT NULL,
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
  KEY idx_lem_lead_created (lead_id, created_at),
  KEY idx_lem_to_address (to_address),
  KEY idx_lem_zoho_message (zoho_message_id),
  CONSTRAINT fk_lem_lead
    FOREIGN KEY (lead_id) REFERENCES leads (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
