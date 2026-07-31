-- Performance indexes for common list/filter/lookup paths.
-- Additive only — no schema semantics change.

ALTER TABLE customers
  ADD INDEX idx_customers_subscription_status (subscription_status),
  ADD INDEX idx_customers_tisp_sync_status (tisp_sync_status);

ALTER TABLE integration_events
  ADD INDEX idx_integration_events_source_status_customer
    (source, status, customer_no);

ALTER TABLE leads
  ADD INDEX idx_leads_email (email);
