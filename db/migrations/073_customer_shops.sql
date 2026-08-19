-- Shops sit under the same building + POP as apartments.
-- Customer number still uses the unit segment (auto SH01, SH02, …).
-- customer_type remains C2B/B2B billing; premise_type is apartment vs shop.

ALTER TABLE customers
  ADD COLUMN premise_type ENUM('apartment', 'shop') NOT NULL DEFAULT 'apartment'
    AFTER customer_type,
  ADD COLUMN business_name VARCHAR(200) NULL AFTER apartment_number,
  ADD COLUMN shop_location VARCHAR(255) NULL AFTER business_name;

CREATE INDEX idx_customer_premise_type ON customers (premise_type);
CREATE INDEX idx_customer_business_name ON customers (business_name);
