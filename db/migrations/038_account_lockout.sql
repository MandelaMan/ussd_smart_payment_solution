-- Account lockout after repeated failed login attempts

ALTER TABLE admin_users
  ADD COLUMN failed_login_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER token_version,
  ADD COLUMN locked_until TIMESTAMP NULL DEFAULT NULL AFTER failed_login_count;
