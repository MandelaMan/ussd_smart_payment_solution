-- Number of TVs on non-internet-only packages. 1 is included; each extra
-- TV adds a KES 500 Extra TV line on signup and recurring invoices.

ALTER TABLE customers
  ADD COLUMN tv_count INT UNSIGNED NOT NULL DEFAULT 1 AFTER package_price;

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
    'reassign',
    'tv_count'
  ) NOT NULL;
