-- Auth hardening: JWT invalidation via token_version + login audit trail

ALTER TABLE admin_users
  ADD COLUMN token_version INT UNSIGNED NOT NULL DEFAULT 0 AFTER is_active;

CREATE TABLE IF NOT EXISTS auth_login_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(191) NULL,
  user_id BIGINT UNSIGNED NULL,
  outcome ENUM('success', 'failure', 'logout', 'lockout') NOT NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(500) NULL,
  reason VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_auth_login_created (created_at),
  KEY idx_auth_login_email (email),
  KEY idx_auth_login_outcome (outcome),
  CONSTRAINT fk_auth_login_user
    FOREIGN KEY (user_id) REFERENCES admin_users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
