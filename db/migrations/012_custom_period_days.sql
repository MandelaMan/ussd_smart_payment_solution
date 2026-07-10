-- Store custom billing periods in days (converted from months where applicable).
UPDATE customers
SET custom_period_months = custom_period_months * 30
WHERE payment_frequency = 'custom'
  AND custom_period_months IS NOT NULL;

ALTER TABLE customers
  CHANGE COLUMN custom_period_months custom_period_days INT UNSIGNED NULL;
