-- Unified base Mbps for Basic / Basic Plus across all package categories.

UPDATE package_plan_variants v
JOIN package_plans pl ON pl.id = v.plan_id
SET v.default_mbps = CASE
  WHEN pl.code = 'basic' AND v.payment_frequency = 'monthly' THEN 100
  WHEN pl.code = 'basic_plus' AND v.payment_frequency = 'monthly' THEN 150
  WHEN pl.code = 'basic' AND v.payment_frequency = 'quarterly' THEN 150
  WHEN pl.code = 'basic_plus' AND v.payment_frequency = 'quarterly' THEN 250
  WHEN pl.code = 'basic' AND v.payment_frequency = 'yearly' THEN 200
  WHEN pl.code = 'basic_plus' AND v.payment_frequency = 'yearly' THEN 500
  ELSE v.default_mbps
END;

-- Keep catalog-linked building products in sync with base speeds.
UPDATE products p
JOIN package_plan_variants v ON v.id = p.plan_variant_id
SET p.mbps = v.default_mbps
WHERE p.plan_variant_id IS NOT NULL;
