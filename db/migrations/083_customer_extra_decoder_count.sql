-- Extra DSTV decoders beyond the one included with the package.
-- First invoice: 2900 × (1 + extra_decoder_count). Recurring: 3500 × extra only.

ALTER TABLE customers
  ADD COLUMN extra_decoder_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER tv_count;

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
