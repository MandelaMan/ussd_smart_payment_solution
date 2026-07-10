-- Expand Enaki static IP prefixes to match live ISP allocations.
UPDATE buildings
SET ip_prefixes = JSON_ARRAY(
  '10.10.10.',
  '10.11.10.',
  '10.11.11.',
  '10.12.10.',
  '41.79.10.'
)
WHERE name = 'Enaki';
