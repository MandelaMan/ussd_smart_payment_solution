-- Optional building block (e.g. A / Block A). Location metadata only —
-- never part of the customer number (AZE-AH-4G, not AZE-AH-4G-BLOCK-A).

ALTER TABLE customers
  ADD COLUMN `block` VARCHAR(50) NULL AFTER apartment_number;

ALTER TABLE leads
  ADD COLUMN `block` VARCHAR(50) NULL AFTER apartment_number;
