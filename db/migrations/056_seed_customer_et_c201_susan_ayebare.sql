-- Idempotent seed / repair for Enaki apartment C201 (ET-C201 — Susan Ayebare).
-- Safe to re-run: skips insert when customer_number, active apartment, or IP already exists.
-- Resolves building/product by name so IDs can differ across environments.

-- 1) Clear placeholder billing address on existing ET-C201 (Zoho rejects bad address payloads)
UPDATE customers
SET
  billing_attention = NULL,
  billing_address = NULL,
  billing_street2 = NULL,
  billing_city = NULL,
  billing_state = NULL,
  billing_zip = NULL,
  billing_country = NULL,
  zoho_billing_error = NULL,
  zoho_billing_status = CASE
    WHEN zoho_billing_status = 'failed' THEN 'pending'
    ELSE zoho_billing_status
  END
WHERE customer_number = 'ET-C201'
  AND (
    billing_attention = 'Test'
    OR billing_address = 'Test'
    OR billing_street2 = 'Test'
  );

-- 2) Insert customer when missing (stage / fresh environments)
INSERT INTO customers (
  first_name,
  middle_name,
  last_name,
  phone,
  email,
  billing_attention,
  billing_address,
  billing_street2,
  billing_city,
  billing_state,
  billing_zip,
  billing_country,
  ip_address,
  is_vat_exempt,
  customer_type,
  apartment_number,
  payment_frequency,
  custom_period_days,
  building_id,
  product_id,
  agency_id,
  customer_number,
  tisp_password,
  ppoe_username,
  package_price,
  decoder_fee_amount,
  decoder_fee_required,
  dstv_decoder_serial,
  trial_period_enabled,
  trial_ends_at,
  subscription_status,
  status
)
SELECT
  'Susan',
  NULL,
  'Ayebare',
  '254717560417',
  'magu.susan@gmail.com',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  '10.12.10.7',
  0,
  'C2B',
  'C201',
  'monthly',
  NULL,
  b.id,
  p.id,
  NULL,
  'ET-C201',
  'C201',
  NULL,
  3900.00,
  NULL,
  0,
  NULL,
  0,
  NULL,
  'Active',
  'active'
FROM buildings b
INNER JOIN products p
  ON p.building_id = b.id
 AND p.payment_frequency = 'monthly'
 AND p.is_active = 1
 AND p.price = 3900.00
 AND p.name LIKE 'Basic%'
WHERE b.name = 'Enaki'
  AND NOT EXISTS (
    SELECT 1 FROM customers c WHERE c.customer_number = 'ET-C201'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM customers c
    WHERE c.building_id = b.id
      AND c.apartment_number = 'C201'
      AND c.status = 'active'
  )
  AND NOT EXISTS (
    SELECT 1 FROM customers c WHERE c.ip_address = '10.12.10.7'
  )
ORDER BY p.id ASC
LIMIT 1;

-- 3) Apartment history for newly inserted (or existing) ET-C201 when missing an open signup row
INSERT INTO apartment_history (
  building_id,
  apartment_number,
  customer_id,
  customer_number,
  customer_name,
  ip_address,
  reason
)
SELECT
  c.building_id,
  c.apartment_number,
  c.id,
  c.customer_number,
  TRIM(CONCAT_WS(' ', c.first_name, c.middle_name, c.last_name)),
  c.ip_address,
  'signup'
FROM customers c
WHERE c.customer_number = 'ET-C201'
  AND NOT EXISTS (
    SELECT 1
    FROM apartment_history h
    WHERE h.customer_id = c.id
      AND h.reason = 'signup'
      AND h.moved_out_at IS NULL
  );

-- 4) Created event when missing
INSERT INTO customer_events (
  customer_id,
  event_type,
  new_product_id,
  new_apartment,
  notes
)
SELECT
  c.id,
  'created',
  c.product_id,
  c.apartment_number,
  'Customer signed up (stage migration 056)'
FROM customers c
WHERE c.customer_number = 'ET-C201'
  AND NOT EXISTS (
    SELECT 1
    FROM customer_events e
    WHERE e.customer_id = c.id
      AND e.event_type = 'created'
  );
