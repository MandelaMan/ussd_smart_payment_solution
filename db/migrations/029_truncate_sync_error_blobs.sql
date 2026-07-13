-- TISP/Zoho error fields sometimes stored full HTML pages, bloating customer list payloads.
UPDATE customers
SET tisp_sync_error = LEFT(tisp_sync_error, 240)
WHERE tisp_sync_error IS NOT NULL
  AND CHAR_LENGTH(tisp_sync_error) > 240;

UPDATE customers
SET zoho_billing_error = LEFT(zoho_billing_error, 240)
WHERE zoho_billing_error IS NOT NULL
  AND CHAR_LENGTH(zoho_billing_error) > 240;
