-- Optional per-building code for customer numbers under multi-building POPs.
-- Format when set and different from POP C2B/B2B: {POP_CODE}-{BUILDING_CODE}-{APT}
-- e.g. AZE-TGA-401A. Single-building POPs (Enaki, Colosseum, Skynest) leave code NULL
-- so numbers stay {POP_CODE}-{APT} (ET-401A).

ALTER TABLE buildings
  ADD COLUMN building_code VARCHAR(10) NULL AFTER name;

UPDATE buildings SET building_code = 'TGA'
WHERE name = 'Taarifa Garden Apartments' AND (building_code IS NULL OR building_code = '');

UPDATE buildings SET building_code = 'AH'
WHERE name = 'Azalea Heights' AND (building_code IS NULL OR building_code = '');

UPDATE buildings SET building_code = 'BT'
WHERE name = 'Brookside Terraces' AND (building_code IS NULL OR building_code = '');

-- Unique within a POP when set (NULLs allowed for 1:1 POP buildings)
SET @uk_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'buildings'
    AND index_name = 'uk_building_pop_code'
);
SET @sql := IF(
  @uk_exists = 0,
  'ALTER TABLE buildings ADD UNIQUE KEY uk_building_pop_code (pop_id, building_code)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
