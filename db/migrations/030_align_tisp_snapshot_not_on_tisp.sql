-- Keep TISP snapshots aligned with customers.subscription_status after "Account Not Found"
-- syncs. Stale ACTIVE/SUSPENDED snapshots made status filters look wrong vs expand panel.
UPDATE tisp_customer_snapshots ts
INNER JOIN customers c ON c.id = ts.customer_id
SET
  ts.subscription_status = 'Not on TISP',
  ts.updated_at = CURRENT_TIMESTAMP
WHERE LOWER(TRIM(COALESCE(c.subscription_status, ''))) IN ('not on tisp', 'unknown', 'not_on_tisp')
  AND ts.subscription_status IS NOT NULL
  AND LOWER(TRIM(ts.subscription_status)) NOT IN ('not on tisp', 'unknown', 'not_on_tisp', '');
