ALTER TABLE buildings
  ADD COLUMN dstv_setup ENUM('headend_coax', 'decoder') NOT NULL DEFAULT 'decoder'
  AFTER ip_setup;
