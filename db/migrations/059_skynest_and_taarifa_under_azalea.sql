-- Ensure Skynest is a POP with Skynest building under it.
-- Remap staging "Taarifa Garden Apartments" (and name variants) under Azalea POP.
-- If 058 turned Taarifa into its own POP, fold that POP into Azalea.

-- --- Skynest ---
INSERT INTO pops (name, c2b_code, b2b_code, ip_setup, dstv_setup, ip_prefixes)
SELECT 'Skynest', 'SKY', 'SKYB', 'STATIC', 'decoder', JSON_ARRAY('192.168.88.', '192.168.89.')
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM pops WHERE name = 'Skynest');

UPDATE buildings b
JOIN pops p ON p.name = 'Skynest'
SET b.pop_id = p.id
WHERE b.name = 'Skynest'
  AND (b.pop_id IS NULL OR b.pop_id <> p.id);

INSERT INTO buildings (pop_id, name, ip_prefixes)
SELECT p.id, 'Skynest', JSON_ARRAY('192.168.88.', '192.168.89.')
FROM pops p
WHERE p.name = 'Skynest'
  AND NOT EXISTS (SELECT 1 FROM buildings b WHERE b.name = 'Skynest');

-- --- Taarifa → Azalea ---
-- Move any Taarifa* buildings under Azalea
UPDATE buildings b
JOIN pops az ON az.name = 'Azalea'
SET b.pop_id = az.id
WHERE (
    b.name = 'Taarifa Garden Apartments'
    OR b.name = 'Taarifa Gardens'
    OR b.name = 'Taarifa Gardens Apartments'
    OR b.name LIKE 'Taarifa%'
  )
  AND b.pop_id <> az.id;

-- Move OLTs from a standalone Taarifa POP onto Azalea
UPDATE pop_olts o
JOIN pops tp ON tp.id = o.pop_id
JOIN pops az ON az.name = 'Azalea'
SET o.pop_id = az.id
WHERE (
    tp.name = 'Taarifa Garden Apartments'
    OR tp.name = 'Taarifa Gardens'
    OR tp.name = 'Taarifa Gardens Apartments'
    OR tp.name LIKE 'Taarifa%'
  )
  AND o.pop_id <> az.id;

-- Drop orphan Taarifa POPs (no buildings left)
DELETE p FROM pops p
WHERE (
    p.name = 'Taarifa Garden Apartments'
    OR p.name = 'Taarifa Gardens'
    OR p.name = 'Taarifa Gardens Apartments'
    OR p.name LIKE 'Taarifa%'
  )
  AND NOT EXISTS (SELECT 1 FROM buildings b WHERE b.pop_id = p.id);

-- Ensure the building exists under Azalea (local + staging parity)
INSERT INTO buildings (pop_id, name, ip_prefixes)
SELECT az.id, 'Taarifa Garden Apartments', JSON_ARRAY()
FROM pops az
WHERE az.name = 'Azalea'
  AND NOT EXISTS (
    SELECT 1 FROM buildings b
    WHERE b.name IN (
      'Taarifa Garden Apartments',
      'Taarifa Gardens',
      'Taarifa Gardens Apartments'
    )
  );
