-- Temporary service pause (away): dates and reason for billing deferral.
ALTER TABLE customers
  ADD COLUMN pause_start_date DATE NULL AFTER dstv_decoder_collected_at,
  ADD COLUMN pause_end_date DATE NULL AFTER pause_start_date,
  ADD COLUMN pause_reason VARCHAR(500) NULL AFTER pause_end_date;
