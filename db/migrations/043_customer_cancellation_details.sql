-- Cancellation reason and equipment collection dates (ONU + DSTV decoder).
ALTER TABLE customers
  ADD COLUMN cancellation_reason VARCHAR(500) NULL AFTER subscription_status,
  ADD COLUMN onu_collected_at DATE NULL AFTER cancellation_reason,
  ADD COLUMN dstv_decoder_collected_at DATE NULL AFTER onu_collected_at;

ALTER TABLE apartment_history
  ADD COLUMN onu_collected_at DATE NULL AFTER ip_address,
  ADD COLUMN dstv_decoder_collected_at DATE NULL AFTER onu_collected_at;
