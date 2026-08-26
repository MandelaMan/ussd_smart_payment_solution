-- Credit unused pause days onto the next subscription, and record the event type.
ALTER TABLE customers
  ADD COLUMN pause_credit_days INT UNSIGNED NULL AFTER pause_reason,
  ADD COLUMN pause_original_due_date DATE NULL AFTER pause_credit_days,
  ADD COLUMN pause_credited_due_date DATE NULL AFTER pause_original_due_date,
  ADD COLUMN pause_credit_applied_at DATETIME NULL AFTER pause_credited_due_date;

ALTER TABLE customer_events
  MODIFY event_type ENUM(
    'created',
    'upgrade',
    'downgrade',
    'switch_apartment',
    'cancel',
    'type_change',
    'disconnect',
    'pause'
  ) NOT NULL;
