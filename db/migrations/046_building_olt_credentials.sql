-- Per-building EMS login (no longer stored in .env)
ALTER TABLE buildings
  ADD COLUMN olt_username VARCHAR(100) NULL AFTER olt_mac,
  ADD COLUMN olt_password VARCHAR(255) NULL AFTER olt_username,
  ADD COLUMN olt_tenant_id VARCHAR(32) NULL AFTER olt_password;

-- Azalea — credentials from INCE EMS docs / live Tailscale tests
UPDATE buildings
SET olt_username = 'admin',
    olt_password = 'admin@2024',
    olt_tenant_id = '000000'
WHERE LOWER(name) = 'azalea'
  AND olt_host IS NOT NULL;
