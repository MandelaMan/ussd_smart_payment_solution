-- Add Premium Plus plan (Basic, Basic Plus, Premium, Premium Plus)
-- This only updates the package catalog (package_plans + package_plan_variants).
-- Building-specific prices still live in `products` and must be created/activated separately.

-- Premium Plus on Internet Only / Apartonet / Internet+DSTV+Apartonet
INSERT INTO package_plans (category_id, code, name, sort_order)
SELECT c.id, 'premium_plus', 'Premium Plus', 4
FROM package_categories c
WHERE c.code IN ('internet_only', 'internet_apartonet', 'internet_dstv_apartonet')
  AND NOT EXISTS (
    SELECT 1 FROM package_plans p
    WHERE p.category_id = c.id AND p.code = 'premium_plus'
  );

-- Premium Plus base Mbps ladder (placeholder defaults for admin UI speed field)
-- monthly 250 · quarterly 450 · yearly 700
INSERT INTO package_plan_variants (plan_id, payment_frequency, default_mbps)
SELECT p.id, freq.payment_frequency, freq.default_mbps
FROM package_plans p
CROSS JOIN (
  SELECT 'monthly' AS payment_frequency, 250 AS default_mbps
  UNION ALL SELECT 'quarterly', 450
  UNION ALL SELECT 'yearly', 700
) freq
WHERE p.code = 'premium_plus'
  AND NOT EXISTS (
    SELECT 1 FROM package_plan_variants v
    WHERE v.plan_id = p.id AND v.payment_frequency = freq.payment_frequency
  );

-- Premium Plus for DSTV Only category (TV without Apartonet / internet packaging)
INSERT INTO package_plans (category_id, code, name, sort_order)
SELECT c.id, 'premium_plus', 'Premium Plus', 4
FROM package_categories c
WHERE c.code = 'dstv_only'
  AND NOT EXISTS (
    SELECT 1 FROM package_plans p
    WHERE p.category_id = c.id AND p.code = 'premium_plus'
  );

-- Variants for DSTV Only plans (same Mbps ladder as internet categories)
INSERT INTO package_plan_variants (plan_id, payment_frequency, default_mbps)
SELECT p.id, freq.payment_frequency, freq.default_mbps
FROM package_plans p
JOIN package_categories c ON c.id = p.category_id
CROSS JOIN (
  SELECT 'monthly' AS payment_frequency, 250 AS default_mbps
  UNION ALL SELECT 'quarterly', 450
  UNION ALL SELECT 'yearly', 700
) freq
WHERE c.code = 'dstv_only'
  AND p.code = 'premium_plus'
  AND NOT EXISTS (
    SELECT 1 FROM package_plan_variants v
    WHERE v.plan_id = p.id AND v.payment_frequency = freq.payment_frequency
  );

