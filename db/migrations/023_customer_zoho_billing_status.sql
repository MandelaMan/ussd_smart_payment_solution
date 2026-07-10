ALTER TABLE customers
  ADD COLUMN zoho_billing_status ENUM('pending', 'completed', 'failed') NOT NULL DEFAULT 'pending' AFTER tisp_sync_error,
  ADD COLUMN zoho_billing_error TEXT NULL AFTER zoho_billing_status;

-- Customers with a stored Zoho billing snapshot were onboarded successfully.
UPDATE customers c
SET c.zoho_billing_status = 'completed'
WHERE EXISTS (
  SELECT 1 FROM zoho_customer_contacts zcc WHERE zcc.customer_id = c.id
)
AND (
  EXISTS (SELECT 1 FROM zoho_customer_invoices zci WHERE zci.customer_id = c.id)
  OR EXISTS (SELECT 1 FROM zoho_recurring_invoices zri WHERE zri.customer_id = c.id)
);
