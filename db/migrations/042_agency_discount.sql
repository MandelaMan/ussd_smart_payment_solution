-- Optional negotiated discount % offered when an agency is onboarded.
-- Applied to each client's package price when invoicing the agency
-- (e.g. 6950 @ 14.88% → 5916 × client count).

ALTER TABLE agencies
  ADD COLUMN discount_percent DECIMAL(6, 3) NULL
    COMMENT 'Optional agency discount percent (e.g. 14.880)'
    AFTER contact_person;
