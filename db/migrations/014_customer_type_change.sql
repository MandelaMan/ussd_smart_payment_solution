ALTER TABLE customer_events
  MODIFY event_type ENUM(
    'created',
    'upgrade',
    'downgrade',
    'switch_apartment',
    'cancel',
    'type_change'
  ) NOT NULL;

ALTER TABLE activity_logs
  MODIFY event_type ENUM(
    'payment_received',
    'payment_failed',
    'zoho_invoice_created',
    'zoho_invoice_updated',
    'zoho_invoice_failed',
    'tisp_reconnected',
    'tisp_reconnect_failed',
    'customer_created',
    'customer_created_tisp_failed',
    'customer_cancelled',
    'customer_upgraded',
    'customer_downgraded',
    'customer_apartment_switched',
    'upgrade_payment_pending',
    'upgrade_payment_completed',
    'customer_type_changed'
  ) NOT NULL;
