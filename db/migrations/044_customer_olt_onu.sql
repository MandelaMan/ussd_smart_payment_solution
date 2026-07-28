ALTER TABLE customers
  ADD COLUMN olt_mac VARCHAR(17) NULL AFTER ppoe_username,
  ADD COLUMN onu_index_str VARCHAR(32) NULL AFTER olt_mac,
  ADD COLUMN onu_sn VARCHAR(50) NULL AFTER onu_index_str;

ALTER TABLE api_call_logs
  MODIFY service ENUM('tisp', 'zoho', 'mpesa', 'olt', 'other') NOT NULL;
