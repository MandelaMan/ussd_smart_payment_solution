ALTER TABLE customers
  ADD COLUMN tisp_sync_status ENUM('pending', 'synced', 'failed') NOT NULL DEFAULT 'pending' AFTER subscription_status,
  ADD COLUMN tisp_sync_error TEXT NULL AFTER tisp_sync_status;
