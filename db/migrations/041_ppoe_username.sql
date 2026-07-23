-- PPPoE credentials: username stored separately from apartment number.
-- Default for existing PPOE customers = customer_number (AccountNumber).

ALTER TABLE customers
  ADD COLUMN ppoe_username VARCHAR(50) NULL AFTER tisp_password;

UPDATE customers c
JOIN buildings b ON b.id = c.building_id
SET c.ppoe_username = c.customer_number
WHERE UPPER(b.ip_setup) = 'PPOE'
  AND (c.ppoe_username IS NULL OR TRIM(c.ppoe_username) = '');
