-- Use ASCII hyphens in product display names so UI charts never show
-- em-dash mojibake (γçö / ΓÇö) from charset mismatches.

UPDATE products p
INNER JOIN package_plan_variants v ON v.id = p.plan_variant_id
INNER JOIN package_plans pl ON pl.id = v.plan_id
INNER JOIN package_categories c ON c.id = pl.category_id
SET p.name = CONCAT(pl.name, ' - ', c.name)
WHERE p.plan_variant_id IS NOT NULL;

UPDATE products
SET name = REPLACE(name, ' — ', ' - ')
WHERE name LIKE '% — %';

UPDATE products
SET name = REPLACE(name, ' – ', ' - ')
WHERE name LIKE '% – %';

UPDATE products
SET name = REPLACE(name, ' · ', ' - ')
WHERE name LIKE '% · %';

UPDATE products
SET name = REPLACE(name, ' ?? ', ' - ')
WHERE name LIKE '% ?? %';

UPDATE products
SET name = REPLACE(name, ' γçö ', ' - ')
WHERE name LIKE '% γçö %';

UPDATE products
SET name = REPLACE(name, ' ΓÇö ', ' - ')
WHERE name LIKE '% ΓÇö %';
