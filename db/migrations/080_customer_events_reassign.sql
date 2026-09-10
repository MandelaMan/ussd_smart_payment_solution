-- Allow admin reassignment when a package with customers is deleted.

ALTER TABLE customer_events
  MODIFY event_type ENUM(
    'created',
    'upgrade',
    'downgrade',
    'switch_apartment',
    'cancel',
    'type_change',
    'disconnect',
    'pause',
    'reassign'
  ) NOT NULL;
