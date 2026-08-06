-- Enforce: Brookside Terraces must belong to Azalea POP
-- This is safe to re-run and covers partial migration state.

SET @azalea_pop_id := (
  SELECT id FROM pops WHERE name COLLATE utf8mb4_general_ci = 'Azalea' LIMIT 1
);

UPDATE buildings
SET pop_id = @azalea_pop_id
WHERE name COLLATE utf8mb4_general_ci = 'Brookside Terraces'
  AND @azalea_pop_id IS NOT NULL
  AND (pop_id IS NULL OR pop_id <> @azalea_pop_id);

