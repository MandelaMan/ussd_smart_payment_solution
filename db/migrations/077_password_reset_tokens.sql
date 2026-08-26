-- Time-limited, single-use staff password reset tokens (hashed at rest).

CREATE TABLE IF NOT EXISTS admin_password_reset_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_password_reset_tokens_hash (token_hash),
  KEY idx_admin_password_reset_tokens_user (user_id, expires_at),
  CONSTRAINT fk_admin_password_reset_tokens_user
    FOREIGN KEY (user_id) REFERENCES admin_users(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_admin_password_reset_tokens_created_by
    FOREIGN KEY (created_by_user_id) REFERENCES admin_users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
