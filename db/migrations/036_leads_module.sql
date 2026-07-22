-- Lead generation: WhatsApp + website/embed intake

CREATE TABLE IF NOT EXISTS leads (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  source ENUM('whatsapp', 'web', 'embed') NOT NULL,
  status ENUM('new', 'contacted', 'qualified', 'converted', 'closed') NOT NULL DEFAULT 'new',
  name VARCHAR(200) NULL,
  phone VARCHAR(32) NULL,
  email VARCHAR(191) NULL,
  interest VARCHAR(100) NULL,
  building_interest VARCHAR(200) NULL,
  message TEXT NULL,
  notes TEXT NULL,
  whatsapp_wa_id VARCHAR(32) NULL,
  conversation_state VARCHAR(64) NULL,
  metadata JSON NULL,
  converted_customer_id INT UNSIGNED NULL,
  assigned_to BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_leads_status (status),
  KEY idx_leads_source (source),
  KEY idx_leads_phone (phone),
  KEY idx_leads_whatsapp_wa_id (whatsapp_wa_id),
  KEY idx_leads_created (created_at),
  CONSTRAINT fk_leads_converted_customer
    FOREIGN KEY (converted_customer_id) REFERENCES customers (id) ON DELETE SET NULL,
  CONSTRAINT fk_leads_assigned_to
    FOREIGN KEY (assigned_to) REFERENCES admin_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lead_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_id INT UNSIGNED NOT NULL,
  direction ENUM('inbound', 'outbound') NOT NULL,
  channel ENUM('whatsapp', 'web', 'embed', 'system') NOT NULL,
  body TEXT NOT NULL,
  payload JSON NULL,
  external_message_id VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lead_messages_lead (lead_id, created_at),
  KEY idx_lead_messages_external (external_message_id),
  CONSTRAINT fk_lead_messages_lead
    FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
