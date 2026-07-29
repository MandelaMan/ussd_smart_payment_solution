-- Per-building OLT EMS endpoint (each site has its own OLT IP + MAC)
ALTER TABLE buildings
  ADD COLUMN olt_host VARCHAR(255) NULL AFTER dstv_setup,
  ADD COLUMN olt_port INT UNSIGNED NULL DEFAULT 38881 AFTER olt_host,
  ADD COLUMN olt_mac VARCHAR(17) NULL AFTER olt_port;

-- Azalea (Tailscale EMS + OLT MAC from live tests)
UPDATE buildings
SET olt_host = '100.114.194.126',
    olt_port = 38881,
    olt_mac = '6c:68:a4:ee:93:74'
WHERE LOWER(name) = 'azalea';
