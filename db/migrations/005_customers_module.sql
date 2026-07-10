CREATE TABLE IF NOT EXISTS buildings (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  c2b_code VARCHAR(10) NOT NULL,
  b2b_code VARCHAR(10) NOT NULL,
  ip_setup ENUM('STATIC', 'PPOE') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_building_name (name),
  UNIQUE KEY uk_building_c2b (c2b_code),
  UNIQUE KEY uk_building_b2b (b2b_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS agencies (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(191) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  contact_person VARCHAR(200) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agency_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS products (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  mbps INT UNSIGNED NOT NULL,
  payment_frequency ENUM('monthly', 'quarterly', 'yearly') NOT NULL,
  has_dstv TINYINT(1) NOT NULL DEFAULT 0,
  building_id INT UNSIGNED NOT NULL,
  price DECIMAL(12, 2) NOT NULL,
  monthly_price DECIMAL(12, 2) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_product_building (building_id),
  KEY idx_product_frequency (payment_frequency),
  UNIQUE KEY uk_product_variant (name, building_id, payment_frequency),
  CONSTRAINT fk_product_building FOREIGN KEY (building_id) REFERENCES buildings (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  first_name VARCHAR(100) NOT NULL,
  middle_name VARCHAR(100) NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  email VARCHAR(191) NULL,
  ip_address VARCHAR(45) NULL,
  is_vat_exempt TINYINT(1) NOT NULL DEFAULT 0,
  customer_type ENUM('C2B', 'B2B') NOT NULL,
  apartment_number VARCHAR(50) NOT NULL,
  payment_frequency ENUM('monthly', 'quarterly', 'yearly', 'custom') NOT NULL,
  custom_period_months INT UNSIGNED NULL,
  building_id INT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NOT NULL,
  agency_id INT UNSIGNED NULL,
  customer_number VARCHAR(50) NOT NULL,
  tisp_password VARCHAR(50) NULL,
  package_price DECIMAL(12, 2) NOT NULL,
  subscription_status VARCHAR(100) NULL,
  last_payment_date DATE NULL,
  status ENUM('active', 'cancelled') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_customer_number (customer_number),
  UNIQUE KEY uk_ip_address (ip_address),
  KEY idx_customer_building (building_id),
  KEY idx_customer_status (status),
  KEY idx_customer_agency (agency_id),
  CONSTRAINT fk_customer_building FOREIGN KEY (building_id) REFERENCES buildings (id),
  CONSTRAINT fk_customer_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT fk_customer_agency FOREIGN KEY (agency_id) REFERENCES agencies (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS apartment_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  building_id INT UNSIGNED NOT NULL,
  apartment_number VARCHAR(50) NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  customer_number VARCHAR(50) NOT NULL,
  customer_name VARCHAR(200) NOT NULL,
  moved_in_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  moved_out_at TIMESTAMP NULL,
  reason ENUM('signup', 'switch_in', 'switch_out', 'cancel') NOT NULL,
  PRIMARY KEY (id),
  KEY idx_apartment_lookup (building_id, apartment_number),
  KEY idx_apartment_customer (customer_id),
  CONSTRAINT fk_apt_history_building FOREIGN KEY (building_id) REFERENCES buildings (id),
  CONSTRAINT fk_apt_history_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customer_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id INT UNSIGNED NOT NULL,
  event_type ENUM('created', 'upgrade', 'downgrade', 'switch_apartment', 'cancel') NOT NULL,
  old_product_id INT UNSIGNED NULL,
  new_product_id INT UNSIGNED NULL,
  old_apartment VARCHAR(50) NULL,
  new_apartment VARCHAR(50) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_customer_events (customer_id),
  CONSTRAINT fk_event_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO buildings (name, c2b_code, b2b_code, ip_setup) VALUES
  ('Enaki', 'ET', 'ETH', 'STATIC'),
  ('Colosseum', 'CL', 'CLB', 'STATIC'),
  ('Azalea', 'AZE', 'AZEB', 'PPOE'),
  ('Skynest', 'SKY', 'SKYB', 'STATIC')
ON DUPLICATE KEY UPDATE name = VALUES(name);

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
    'customer_cancelled'
  ) NOT NULL;
