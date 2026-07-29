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
  AND TRIM(b.olt_mac) <> '';

-- Customer link to a specific building OLT (optional until mapped)
ALTER TABLE customers
  ADD COLUMN building_olt_id INT UNSIGNED NULL AFTER onu_sn,
  ADD KEY idx_customers_building_olt (building_olt_id),
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
ALTER TABLE buildings
  DROP COLUMN olt_host,
  DROP COLUMN olt_port,
  DROP COLUMN olt_mac,
  DROP COLUMN olt_username,
  DROP COLUMN olt_password,
  DROP COLUMN olt_tenant_id;
