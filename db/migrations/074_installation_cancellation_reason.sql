-- Reason captured when an installation visit is cancelled.
ALTER TABLE installations
  ADD COLUMN cancellation_reason VARCHAR(500) NULL AFTER notes;
