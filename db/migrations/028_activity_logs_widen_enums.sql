-- Widen activity_logs so billing reconciliation (and other modules) can log
-- without hitting ENUM truncation on event_type / source / status.

ALTER TABLE activity_logs
  MODIFY event_type VARCHAR(64) NOT NULL,
  MODIFY source VARCHAR(32) NOT NULL,
  MODIFY status VARCHAR(16) NOT NULL DEFAULT 'success';
