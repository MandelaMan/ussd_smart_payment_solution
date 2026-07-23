-- Persist IP used during each apartment tenure so unit history can show IP after moves.
ALTER TABLE apartment_history
  ADD COLUMN ip_address VARCHAR(45) NULL AFTER customer_name;

-- Backfill open tenancies from the current customer IP.
UPDATE apartment_history h
INNER JOIN customers c ON c.id = h.customer_id
SET h.ip_address = NULLIF(TRIM(c.ip_address), '')
WHERE h.moved_out_at IS NULL
  AND c.ip_address IS NOT NULL
  AND TRIM(c.ip_address) <> '';
