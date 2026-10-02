-- Indefinite service hold. Separate from the dated away-pause (pause days / credit).
ALTER TABLE customers
  ADD COLUMN pause_indefinite TINYINT(1) NOT NULL DEFAULT 0 AFTER pause_credit_applied_at,
  ADD COLUMN indefinite_pause_due_date DATE NULL AFTER pause_indefinite,
  ADD COLUMN indefinite_pause_iptv_user_id VARCHAR(64) NULL AFTER indefinite_pause_due_date,
  ADD COLUMN pause_stopped_recurring_ids VARCHAR(1000) NULL AFTER indefinite_pause_iptv_user_id;
