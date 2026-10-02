-- Resume after a temporary service pause (split pause-day allowance).

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
    'resume',
    'reassign',
    'tv_count'
  ) NOT NULL;
