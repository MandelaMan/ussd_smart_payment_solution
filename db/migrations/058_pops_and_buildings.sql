-- Introduce POPs as the parent config for buildings.
-- POP owns: C2B/B2B codes, IP setup, IP prefix pool, DSTV setup, OLTs.
-- Building owns: name, address, assigned IP prefixes (subset of POP pool), pop_id.
-- Idempotent: safe to re-run after a partial apply.

CREATE TABLE IF NOT EXISTS pops (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  c2b_code VARCHAR(10) NOT NULL,
  b2b_code VARCHAR(10) NOT NULL,
  ip_setup ENUM('STATIC', 'PPOE') NOT NULL,
  dstv_setup ENUM('headend_coax', 'decoder') NOT NULL DEFAULT 'decoder',
  ip_prefixes JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_pop_name (name),
  UNIQUE KEY uk_pop_c2b (c2b_code),
  UNIQUE KEY uk_pop_b2b (b2b_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Match buildings collation (avoids utf8mb4_0900_ai_ci vs utf8mb4_general_ci on '=')
ALTER TABLE pops CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

-- Seed POPs from buildings that still have legacy config columns
SET @has_building_c2b := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'buildings'
    AND column_name = 'c2b_code'
);

SET @sql := IF(
  @has_building_c2b > 0,
  'INSERT INTO pops (name, c2b_code, b2b_code, ip_setup, dstv_setup, ip_prefixes)
   SELECT
     CASE WHEN b.name COLLATE utf8mb4_general_ci = ''Azalea Heights'' THEN ''Azalea'' ELSE b.name END,
     b.c2b_code,
     b.b2b_code,
     b.ip_setup,
     COALESCE(b.dstv_setup, ''decoder''),
     b.ip_prefixes
   FROM buildings b
   WHERE NOT EXISTS (
     SELECT 1 FROM pops p
     WHERE p.name COLLATE utf8mb4_general_ci =
       CASE WHEN b.name COLLATE utf8mb4_general_ci = ''Azalea Heights'' THEN ''Azalea'' ELSE b.name END
   )',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_pop_id := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'buildings'
    AND column_name = 'pop_id'
);

SET @sql := IF(
  @has_pop_id = 0,
  'ALTER TABLE buildings ADD COLUMN pop_id INT UNSIGNED NULL AFTER id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Link buildings to pops by name (Azalea Heights → Azalea POP)
UPDATE buildings b
JOIN pops p ON p.name COLLATE utf8mb4_general_ci = CASE
  WHEN b.name COLLATE utf8mb4_general_ci IN ('Azalea', 'Azalea Heights') THEN 'Azalea'
  ELSE b.name
END
SET b.pop_id = p.id
WHERE b.pop_id IS NULL;

-- Rename Azalea building → Azalea Heights
UPDATE buildings
SET name = 'Azalea Heights'
WHERE name COLLATE utf8mb4_general_ci = 'Azalea' AND pop_id IS NOT NULL;

-- Ensure pop_id is NOT NULL + FK
UPDATE buildings SET pop_id = pop_id WHERE pop_id IS NOT NULL;

ALTER TABLE buildings
  MODIFY COLUMN pop_id INT UNSIGNED NOT NULL;

SET @fk_building_pop := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE table_schema = DATABASE()
    AND table_name = 'buildings'
    AND constraint_name = 'fk_building_pop'
);
SET @sql := IF(
  @fk_building_pop = 0,
  'ALTER TABLE buildings ADD CONSTRAINT fk_building_pop FOREIGN KEY (pop_id) REFERENCES pops (id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS pop_olts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  pop_id INT UNSIGNED NOT NULL,
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
  UNIQUE KEY uk_pop_olt_mac (pop_id, mac),
  KEY idx_pop_olts_pop (pop_id),
  CONSTRAINT fk_pop_olts_pop
    FOREIGN KEY (pop_id) REFERENCES pops (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE pop_olts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

-- Move OLTs from buildings → their POP (preserve IDs so customer FKs stay valid)
SET @has_building_olts := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'building_olts'
);

SET @sql := IF(
  @has_building_olts > 0,
  'INSERT INTO pop_olts (
     id, pop_id, name, host, port, mac, username, password, tenant_id, is_active, created_at, updated_at
   )
   SELECT
     o.id, b.pop_id, o.name, o.host, o.port, o.mac, o.username, o.password,
     o.tenant_id, o.is_active, o.created_at, o.updated_at
   FROM building_olts o
   JOIN buildings b ON b.id = o.building_id
   ON DUPLICATE KEY UPDATE
     pop_id = VALUES(pop_id),
     name = VALUES(name),
     host = VALUES(host),
     port = VALUES(port),
     mac = VALUES(mac),
     username = VALUES(username),
     password = VALUES(password),
     tenant_id = VALUES(tenant_id),
     is_active = VALUES(is_active)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Retarget customers.building_olt_id → pop_olts
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

SET @customers_fk_exists2 := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE table_schema = DATABASE()
    AND table_name = 'customers'
    AND constraint_name = 'fk_customers_building_olt'
);

SET @sql := IF(
  @customers_fk_exists2 = 0,
  'ALTER TABLE customers ADD CONSTRAINT fk_customers_building_olt FOREIGN KEY (building_olt_id) REFERENCES pop_olts (id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DROP TABLE IF EXISTS building_olts;

-- Drop POP-owned columns from buildings (keep assigned ip_prefixes + address)
SET @uk_c2b := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'buildings' AND index_name = 'uk_building_c2b'
);
SET @sql := IF(@uk_c2b > 0, 'ALTER TABLE buildings DROP INDEX uk_building_c2b', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @uk_b2b := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'buildings' AND index_name = 'uk_building_b2b'
);
SET @sql := IF(@uk_b2b > 0, 'ALTER TABLE buildings DROP INDEX uk_building_b2b', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_c2b := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'buildings' AND column_name = 'c2b_code'
);
SET @sql := IF(@col_c2b > 0, 'ALTER TABLE buildings DROP COLUMN c2b_code', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_b2b := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'buildings' AND column_name = 'b2b_code'
);
SET @sql := IF(@col_b2b > 0, 'ALTER TABLE buildings DROP COLUMN b2b_code', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_ip := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'buildings' AND column_name = 'ip_setup'
);
SET @sql := IF(@col_ip > 0, 'ALTER TABLE buildings DROP COLUMN ip_setup', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_dstv := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'buildings' AND column_name = 'dstv_setup'
);
SET @sql := IF(@col_dstv > 0, 'ALTER TABLE buildings DROP COLUMN dstv_setup', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Brookside Terraces under Azalea (after POP-owned columns are removed)
INSERT INTO buildings (pop_id, name, ip_prefixes)
SELECT p.id, 'Brookside Terraces', JSON_ARRAY()
FROM pops p
WHERE p.name COLLATE utf8mb4_general_ci = 'Azalea'
  AND NOT EXISTS (
    SELECT 1 FROM buildings b
    WHERE b.name COLLATE utf8mb4_general_ci = 'Brookside Terraces'
  );
