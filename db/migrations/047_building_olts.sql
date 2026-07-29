-- Multiple OLTs per building
CREATE TABLE IF NOT EXISTS building_olts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  building_id INT UNSIGNED NOT NULL,
  name VARCHAR(100) NULL,
  host VARCHAR(255) NOT NULL,
  port INT UNSIGNED NOT NULL DEFAULT 38881,
  mac VARCHAR(17) NOT NULL,
  username VARCHAR(100) NOT NULL,
  password VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(32) NOT NULL DEFAULT '000000',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_building_olt_mac (building_id, mac),
  KEY idx_building_olts_building (building_id),
  CONSTRAINT fk_building_olts_building
    FOREIGN KEY (building_id) REFERENCES buildings (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Move existing single-OLT columns into building_olts
INSERT INTO building_olts (building_id, name, host, port, mac, username, password, tenant_id)
SELECT
  b.id,
  CONCAT(b.name, ' OLT'),
  b.olt_host,
  COALESCE(b.olt_port, 38881),
  LOWER(b.olt_mac),
  COALESCE(NULLIF(TRIM(b.olt_username), ''), 'admin'),
  COALESCE(NULLIF(b.olt_password, ''), ''),
  COALESCE(NULLIF(TRIM(b.olt_tenant_id), ''), '000000')
FROM buildings b
WHERE b.olt_host IS NOT NULL
  AND TRIM(b.olt_host) <> ''
  AND b.olt_mac IS NOT NULL
  AND TRIM(b.olt_mac) <> ''
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  host = VALUES(host),
  port = VALUES(port),
  mac = VALUES(mac),
  username = VALUES(username),
  password = VALUES(password),
  tenant_id = VALUES(tenant_id),
  is_active = VALUES(is_active);

-- Customer link to a specific building OLT (optional until mapped)
-- Use dynamic SQL so this migration can be re-run even when DDL doesn't support
-- "IF EXISTS" / "IF NOT EXISTS" for ALTER TABLE on your MySQL/MariaDB version.
SET @customers_fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE table_schema = DATABASE()
    AND table_name = 'customers'
    AND constraint_name = 'fk_customers_building_olt'
    AND constraint_type = 'FOREIGN KEY'
);

SET @sql := IF(
  @customers_fk_exists > 0,
  'ALTER TABLE customers DROP FOREIGN KEY fk_customers_building_olt',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @customers_idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'customers'
    AND index_name = 'idx_customers_building_olt'
);

SET @sql := IF(
  @customers_idx_exists > 0,
  'ALTER TABLE customers DROP INDEX idx_customers_building_olt',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @customers_col_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'customers'
    AND column_name = 'building_olt_id'
);

SET @sql := IF(
  @customers_col_exists > 0,
  'ALTER TABLE customers DROP COLUMN building_olt_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE customers
  ADD COLUMN building_olt_id INT UNSIGNED NULL AFTER onu_sn;

CREATE INDEX idx_customers_building_olt
  ON customers (building_olt_id);

ALTER TABLE customers
  ADD CONSTRAINT fk_customers_building_olt
    FOREIGN KEY (building_olt_id) REFERENCES building_olts (id) ON DELETE SET NULL;

-- Best-effort: attach existing Azalea-linked customers by building OLT
UPDATE customers c
JOIN buildings b ON b.id = c.building_id
JOIN building_olts o ON o.building_id = b.id
SET c.building_olt_id = o.id
WHERE c.building_olt_id IS NULL
  AND (
    -- Force collations to match to avoid: Illegal mix of collations for '='
    (c.olt_mac IS NOT NULL
      AND LOWER(c.olt_mac) COLLATE utf8mb4_general_ci =
          LOWER(o.mac) COLLATE utf8mb4_general_ci)
    OR c.onu_index_str IS NOT NULL
    OR c.onu_sn IS NOT NULL
  );

-- Drop legacy single-OLT columns from buildings
-- Same dynamic approach for compatibility across MySQL/MariaDB versions.
SET @b_olt_host_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'buildings'
    AND column_name = 'olt_host'
);
SET @sql := IF(@b_olt_host_exists > 0, 'ALTER TABLE buildings DROP COLUMN olt_host', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @b_olt_port_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'buildings'
    AND column_name = 'olt_port'
);
SET @sql := IF(@b_olt_port_exists > 0, 'ALTER TABLE buildings DROP COLUMN olt_port', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @b_olt_mac_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'buildings'
    AND column_name = 'olt_mac'
);
SET @sql := IF(@b_olt_mac_exists > 0, 'ALTER TABLE buildings DROP COLUMN olt_mac', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @b_olt_username_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'buildings'
    AND column_name = 'olt_username'
);
SET @sql := IF(@b_olt_username_exists > 0, 'ALTER TABLE buildings DROP COLUMN olt_username', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @b_olt_password_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'buildings'
    AND column_name = 'olt_password'
);
SET @sql := IF(@b_olt_password_exists > 0, 'ALTER TABLE buildings DROP COLUMN olt_password', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @b_olt_tenant_id_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'buildings'
    AND column_name = 'olt_tenant_id'
);
SET @sql := IF(@b_olt_tenant_id_exists > 0, 'ALTER TABLE buildings DROP COLUMN olt_tenant_id', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
