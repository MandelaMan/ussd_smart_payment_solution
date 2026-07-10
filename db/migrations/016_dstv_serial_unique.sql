-- Normalize blank DSTV serials and enforce uniqueness (NULL allowed for non-DSTV customers)
UPDATE customers
SET dstv_decoder_serial = NULL
WHERE dstv_decoder_serial IS NOT NULL AND TRIM(dstv_decoder_serial) = '';

UPDATE customers
SET dstv_decoder_serial = UPPER(TRIM(dstv_decoder_serial))
WHERE dstv_decoder_serial IS NOT NULL;

-- Clear duplicate serials (keep lowest id per serial) before adding unique key
UPDATE customers c
INNER JOIN (
  SELECT dstv_decoder_serial, MIN(id) AS keep_id
  FROM customers
  WHERE dstv_decoder_serial IS NOT NULL
  GROUP BY dstv_decoder_serial
  HAVING COUNT(*) > 1
) d ON c.dstv_decoder_serial = d.dstv_decoder_serial AND c.id <> d.keep_id
SET c.dstv_decoder_serial = NULL;

ALTER TABLE customers
  ADD UNIQUE KEY uk_dstv_decoder_serial (dstv_decoder_serial);
