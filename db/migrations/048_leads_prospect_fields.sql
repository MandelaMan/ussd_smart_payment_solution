-- Prospect fields for leads (non-customers). Idempotent for re-runs.

SET @db := DATABASE();

SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'apartment_number'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE leads ADD COLUMN apartment_number VARCHAR(50) NULL AFTER building_interest',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'building_id'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE leads ADD COLUMN building_id INT UNSIGNED NULL AFTER apartment_number',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'leads' AND INDEX_NAME = 'idx_leads_building'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE leads ADD KEY idx_leads_building (building_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'leads' AND CONSTRAINT_NAME = 'fk_leads_building'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE leads ADD CONSTRAINT fk_leads_building FOREIGN KEY (building_id) REFERENCES buildings (id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
