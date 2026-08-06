-- DSTV Only: no internet bandwidth; product/plan label is "DSTV Only" (not Basic/etc).
-- These customers are billed in Zoho only and must not be provisioned on TISP.

-- Allow explicit skip of TISP sync (no bandwidth / no ISP account).
ALTER TABLE customers
  MODIFY COLUMN tisp_sync_status
    ENUM('pending', 'synced', 'failed', 'skipped') NOT NULL DEFAULT 'pending';

-- Zero default Mbps on DSTV Only catalog variants.
UPDATE package_plan_variants v
JOIN package_plans p ON p.id = v.plan_id
JOIN package_categories c ON c.id = p.category_id
SET v.default_mbps = 0
WHERE c.code = 'dstv_only';

-- Prefer a single canonical DSTV Only plan (rename Basic → DSTV Only).
UPDATE package_plans p
JOIN package_categories c ON c.id = p.category_id
SET p.name = 'DSTV Only',
    p.code = 'dstv_only',
    p.sort_order = 1
WHERE c.code = 'dstv_only'
  AND p.code = 'basic';

-- Point existing DSTV Only products at the canonical plan's matching frequency variant.
UPDATE products prod
JOIN package_plan_variants old_v ON old_v.id = prod.plan_variant_id
JOIN package_plans old_pl ON old_pl.id = old_v.plan_id
JOIN package_categories c ON c.id = old_pl.category_id
JOIN package_plans canon ON canon.category_id = c.id AND canon.code = 'dstv_only'
JOIN package_plan_variants new_v
  ON new_v.plan_id = canon.id
 AND new_v.payment_frequency = old_v.payment_frequency
SET prod.plan_variant_id = new_v.id,
    prod.name = 'DSTV Only',
    prod.mbps = 0,
    prod.extra_bandwidth = 0
WHERE c.code = 'dstv_only'
  AND old_pl.code <> 'dstv_only';

-- Also normalize products already on the canonical plan.
UPDATE products prod
JOIN package_plan_variants v ON v.id = prod.plan_variant_id
JOIN package_plans pl ON pl.id = v.plan_id
JOIN package_categories c ON c.id = pl.category_id
SET prod.name = 'DSTV Only',
    prod.mbps = 0,
    prod.extra_bandwidth = 0
WHERE c.code = 'dstv_only';

-- Remove non-canonical DSTV Only plan tiers (Basic Plus / Premium / Premium Plus).
-- Variants first (FK), then plans. Safe once products point at canonical variants.
DELETE v
FROM package_plan_variants v
JOIN package_plans p ON p.id = v.plan_id
JOIN package_categories c ON c.id = p.category_id
WHERE c.code = 'dstv_only'
  AND p.code <> 'dstv_only';

DELETE p
FROM package_plans p
JOIN package_categories c ON c.id = p.category_id
WHERE c.code = 'dstv_only'
  AND p.code <> 'dstv_only';

-- Mark existing DSTV Only customers as not applicable for TISP.
UPDATE customers cust
JOIN products prod ON prod.id = cust.product_id
JOIN package_plan_variants v ON v.id = prod.plan_variant_id
JOIN package_plans pl ON pl.id = v.plan_id
JOIN package_categories c ON c.id = pl.category_id
SET cust.tisp_sync_status = 'skipped',
    cust.tisp_sync_error = NULL
WHERE c.code = 'dstv_only'
  AND cust.tisp_sync_status IN ('pending', 'failed', 'synced');
