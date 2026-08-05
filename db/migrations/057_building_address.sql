-- Building postal address (Zoho Books billing_address shape + PO Box for local Kenya use).
-- When a customer leaves billing address blank, these fields are copied onto the customer.
ALTER TABLE buildings
  ADD COLUMN address_attention VARCHAR(191) NULL AFTER name,
  ADD COLUMN address_street VARCHAR(255) NULL AFTER address_attention,
  ADD COLUMN address_street2 VARCHAR(255) NULL AFTER address_street,
  ADD COLUMN address_po_box VARCHAR(64) NULL AFTER address_street2,
  ADD COLUMN address_city VARCHAR(100) NULL AFTER address_po_box,
  ADD COLUMN address_state VARCHAR(100) NULL AFTER address_city,
  ADD COLUMN address_zip VARCHAR(32) NULL AFTER address_state,
  ADD COLUMN address_country VARCHAR(100) NULL AFTER address_zip;
