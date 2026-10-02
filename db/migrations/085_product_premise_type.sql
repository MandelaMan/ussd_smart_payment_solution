-- Building prices are apartment- or shop-specific.
-- Existing packages stay apartments so current subscribers keep their plans.

ALTER TABLE products
  ADD COLUMN premise_type ENUM('apartment', 'shop') NOT NULL DEFAULT 'apartment'
    AFTER building_id;

CREATE INDEX idx_product_premise_type ON products (premise_type);

-- Same catalog variant can be priced once per premise in a building.
SET @uk_variant := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'products'
    AND index_name = 'uk_product_building_variant'
);
SET @sql := IF(
  @uk_variant > 0,
  'ALTER TABLE products DROP INDEX uk_product_building_variant',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE products
  ADD UNIQUE KEY uk_product_building_variant (plan_variant_id, building_id, premise_type);

-- Same display name can exist twice (apartment vs shop).
SET @uk_name := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'products'
    AND index_name = 'uk_product_variant'
);
SET @sql := IF(
  @uk_name > 0,
  'ALTER TABLE products DROP INDEX uk_product_variant',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE products
  ADD UNIQUE KEY uk_product_variant (name, building_id, payment_frequency, premise_type);

-- Prices stay unique within a premise so apartment and shop catalogs are independent.
SET @uk_price := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'products'
    AND index_name = 'uk_products_building_price'
);
SET @sql := IF(
  @uk_price > 0,
  'ALTER TABLE products DROP INDEX uk_products_building_price',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE products
  ADD UNIQUE KEY uk_products_building_price (building_id, premise_type, price);
