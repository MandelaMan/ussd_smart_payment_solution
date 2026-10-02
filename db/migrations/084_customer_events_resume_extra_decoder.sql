-- Restore 'resume' on customer_events after 083 extra-decoder enum
-- (083_customer_extra_decoder_count originally omitted resume).

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
    'tv_count',
    'extra_decoder_count'
  ) NOT NULL;
