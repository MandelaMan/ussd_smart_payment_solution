-- Add Premium plan (Basic, Basic Plus, Premium) across existing categories,
-- and a new "DSTV Only" category with the same three plans.

-- Premium on Internet Only / Apartonet / Internet+DSTV+Apartonet
INSERT INTO package_plans (category_id, code, name, sort_order)
SELECT c.id, 'premium', 'Premium', 3
FROM package_categories c
WHERE c.code IN ('internet_only', 'internet_apartonet', 'internet_dstv_apartonet')
  AND NOT EXISTS (
    SELECT 1 FROM package_plans p
    WHERE p.category_id = c.id AND p.code = 'premium'
  );

-- Premium base Mbps: monthly 200 · quarterly 350 · yearly 600
INSERT INTO package_plan_variants (plan_id, payment_frequency, default_mbps)
SELECT p.id, freq.payment_frequency, freq.default_mbps
FROM package_plans p
CROSS JOIN (
  SELECT 'monthly' AS payment_frequency, 200 AS default_mbps
  UNION ALL SELECT 'quarterly', 350
  UNION ALL SELECT 'yearly', 600
) freq
WHERE p.code = 'premium'
  AND NOT EXISTS (
    SELECT 1 FROM package_plan_variants v
    WHERE v.plan_id = p.id AND v.payment_frequency = freq.payment_frequency
  );

-- DSTV Only category (TV without Apartonet / internet packaging)
INSERT INTO package_categories (
  code, name, has_apartonet, has_dstv, requires_decoder_fee, decoder_fee_amount, sort_order
)
SELECT 'dstv_only', 'DSTV Only', 0, 1, 1, 2900.00, 4
WHERE NOT EXISTS (
  SELECT 1 FROM package_categories WHERE code = 'dstv_only'
);

-- Plans for DSTV Only: Basic, Basic Plus, Premium
INSERT INTO package_plans (category_id, code, name, sort_order)
SELECT c.id, plans.code, plans.name, plans.sort_order
FROM package_categories c
CROSS JOIN (
  SELECT 'basic' AS code, 'Basic' AS name, 1 AS sort_order
  UNION ALL SELECT 'basic_plus', 'Basic Plus', 2
  UNION ALL SELECT 'premium', 'Premium', 3
) plans
WHERE c.code = 'dstv_only'
  AND NOT EXISTS (
    SELECT 1 FROM package_plans p
    WHERE p.category_id = c.id AND p.code = plans.code
  );

-- Variants for DSTV Only plans (same Mbps ladder as internet categories)
INSERT INTO package_plan_variants (plan_id, payment_frequency, default_mbps)
SELECT p.id, freq.payment_frequency, freq.default_mbps
FROM package_plans p
JOIN package_categories c ON c.id = p.category_id
CROSS JOIN (
  SELECT 'basic' AS plan_code, 'monthly' AS payment_frequency, 100 AS default_mbps
  UNION ALL SELECT 'basic', 'quarterly', 150
  UNION ALL SELECT 'basic', 'yearly', 200
  UNION ALL SELECT 'basic_plus', 'monthly', 150
  UNION ALL SELECT 'basic_plus', 'quarterly', 250
  UNION ALL SELECT 'basic_plus', 'yearly', 500
  UNION ALL SELECT 'premium', 'monthly', 200
  UNION ALL SELECT 'premium', 'quarterly', 350
  UNION ALL SELECT 'premium', 'yearly', 600
) freq
WHERE c.code = 'dstv_only'
  AND p.code = freq.plan_code
  AND NOT EXISTS (
    SELECT 1 FROM package_plan_variants v
    WHERE v.plan_id = p.id AND v.payment_frequency = freq.payment_frequency
  );
