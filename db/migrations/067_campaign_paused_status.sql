-- Allow pausing a campaign without ending its date window.
ALTER TABLE campaigns
  MODIFY COLUMN status ENUM('draft', 'active', 'paused', 'ended') NOT NULL DEFAULT 'draft';
