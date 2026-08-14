-- Field installations scheduled at customer onboard and apartment switch.
CREATE TABLE IF NOT EXISTS installations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id INT UNSIGNED NOT NULL,
  customer_number VARCHAR(50) NULL,
  building_id INT UNSIGNED NULL,
  apartment_number VARCHAR(50) NULL,
  kind ENUM('onboarding', 'apartment_switch') NOT NULL,
  scheduled_at DATETIME NOT NULL,
  duration_minutes INT UNSIGNED NOT NULL DEFAULT 120,
  assignment_mode ENUM('auto', 'manual') NOT NULL DEFAULT 'auto',
  technician_id BIGINT UNSIGNED NULL,
  status ENUM('unassigned', 'assigned', 'in_progress', 'completed', 'cancelled')
    NOT NULL DEFAULT 'unassigned',
  notes TEXT NULL,
  created_by BIGINT UNSIGNED NULL,
  assigned_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_installations_scheduled (scheduled_at),
  KEY idx_installations_status (status),
  KEY idx_installations_technician (technician_id),
  KEY idx_installations_customer (customer_id),
  KEY idx_installations_kind (kind),
  CONSTRAINT fk_installations_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  CONSTRAINT fk_installations_technician
    FOREIGN KEY (technician_id) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
