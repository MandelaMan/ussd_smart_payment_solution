-- Package catalog: fixed category → plan → billing variant structure.
-- Building-specific prices live in `products` linked via plan_variant_id.

CREATE TABLE IF NOT EXISTS package_categories (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(150) NOT NULL,
  has_apartonet TINYINT(1) NOT NULL DEFAULT 0,
  has_dstv TINYINT(1) NOT NULL DEFAULT 0,
  requires_decoder_fee TINYINT(1) NOT NULL DEFAULT 0,
  decoder_fee_amount DECIMAL(12, 2) NULL,
  sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_category_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS package_plans (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  category_id INT UNSIGNED NOT NULL,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(50) NOT NULL,
  sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_plan_code (category_id, code),
  UNIQUE KEY uk_plan_name (category_id, name),
  CONSTRAINT fk_plan_category FOREIGN KEY (category_id) REFERENCES package_categories (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS package_plan_variants (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan_id INT UNSIGNED NOT NULL,
  payment_frequency ENUM('monthly', 'quarterly', 'yearly') NOT NULL,
  default_mbps INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_plan_frequency (plan_id, payment_frequency),
  CONSTRAINT fk_variant_plan FOREIGN KEY (plan_id) REFERENCES package_plans (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE products
  ADD COLUMN plan_variant_id INT UNSIGNED NULL AFTER id,
  ADD KEY idx_product_plan_variant (plan_variant_id);

ALTER TABLE products
  ADD CONSTRAINT fk_product_plan_variant
  FOREIGN KEY (plan_variant_id) REFERENCES package_plan_variants (id);

ALTER TABLE products
  ADD UNIQUE KEY uk_product_building_variant (plan_variant_id, building_id);

ALTER TABLE customers
  ADD COLUMN decoder_fee_amount DECIMAL(12, 2) NULL AFTER package_price,
  ADD COLUMN decoder_fee_required TINYINT(1) NOT NULL DEFAULT 0 AFTER decoder_fee_amount;

INSERT INTO package_categories (id, code, name, has_apartonet, has_dstv, requires_decoder_fee, decoder_fee_amount, sort_order) VALUES
  (1, 'internet_only', 'Internet Only', 0, 0, 0, NULL, 1),
  (2, 'internet_apartonet', 'Internet + Apartonet Channels', 1, 0, 0, NULL, 2),
  (3, 'internet_dstv_apartonet', 'Internet + DSTV Channels + Apartonet Channels', 1, 1, 1, 2900.00, 3);

INSERT INTO package_plans (id, category_id, code, name, sort_order) VALUES
  (1, 1, 'basic', 'Basic', 1),
  (2, 1, 'basic_plus', 'Basic Plus', 2),
  (3, 2, 'basic', 'Basic', 1),
  (4, 2, 'basic_plus', 'Basic Plus', 2),
  (5, 3, 'basic', 'Basic', 1),
  (6, 3, 'basic_plus', 'Basic Plus', 2);

-- Base Mbps (same for all categories; Basic / Basic Plus × billing frequency)
INSERT INTO package_plan_variants (plan_id, payment_frequency, default_mbps) VALUES
  (1, 'monthly', 100),
  (1, 'quarterly', 150),
  (1, 'yearly', 200),
  (2, 'monthly', 150),
  (2, 'quarterly', 250),
  (2, 'yearly', 500);

INSERT INTO package_plan_variants (plan_id, payment_frequency, default_mbps) VALUES
  (3, 'monthly', 100),
  (3, 'quarterly', 150),
  (3, 'yearly', 200),
  (4, 'monthly', 150),
  (4, 'quarterly', 250),
  (4, 'yearly', 500);

INSERT INTO package_plan_variants (plan_id, payment_frequency, default_mbps) VALUES
  (5, 'monthly', 100),
  (5, 'quarterly', 150),
  (5, 'yearly', 200),
  (6, 'monthly', 150),
  (6, 'quarterly', 250),
  (6, 'yearly', 500);
