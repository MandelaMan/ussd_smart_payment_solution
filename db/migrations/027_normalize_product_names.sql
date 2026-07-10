-- Normalize product display names to use an em dash between plan and category.
-- Rebuilds catalog-linked products from source tables; fixes legacy separators (·, ??, -).

UPDATE products p
INNER JOIN package_plan_variants v ON v.id = p.plan_variant_id
INNER JOIN package_plans pl ON pl.id = v.plan_id
INNER JOIN package_categories c ON c.id = pl.category_id
SET p.name = CONCAT(pl.name, ' — ', c.name)
WHERE p.plan_variant_id IS NOT NULL;

UPDATE products
SET name = REPLACE(name, ' · ', ' — ')
WHERE plan_variant_id IS NULL
  AND name LIKE '% · %';

UPDATE products
SET name = REPLACE(name, ' ?? ', ' — ')
WHERE plan_variant_id IS NULL
  AND name LIKE '% ?? %';

UPDATE products
SET name = REPLACE(name, ' - ', ' — ')
WHERE plan_variant_id IS NULL
  AND name LIKE '% - %';
