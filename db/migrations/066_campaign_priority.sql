-- Support concurrent campaigns with priority (higher = preferred auto-select).
ALTER TABLE campaigns
  ADD COLUMN priority INT NOT NULL DEFAULT 100
    COMMENT 'Higher priority wins when multiple campaigns are active'
    AFTER applies_to_decoder;

UPDATE campaigns SET priority = 100 WHERE priority IS NULL;
