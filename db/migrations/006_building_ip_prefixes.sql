ALTER TABLE buildings
  ADD COLUMN ip_prefixes JSON NULL AFTER ip_setup;

UPDATE buildings SET ip_prefixes = JSON_ARRAY('10.10.10.', '10.11.10.', '10.11.11.', '10.12.10.', '41.79.10.') WHERE name = 'Enaki';
UPDATE buildings SET ip_prefixes = JSON_ARRAY('172.168.1.') WHERE name = 'Colosseum';
UPDATE buildings SET ip_prefixes = JSON_ARRAY() WHERE name = 'Azalea';
UPDATE buildings SET ip_prefixes = JSON_ARRAY('192.168.88.', '192.168.89.') WHERE name = 'Skynest';
