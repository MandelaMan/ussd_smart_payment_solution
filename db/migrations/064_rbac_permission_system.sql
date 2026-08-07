-- RBAC permission system: catalog, groups, overrides, audit, and role simplification.
-- Migrates legacy roles (support/cfo/partner/ceo) → system role `user` + groups.
-- Permission catalog / group presets are synced on application boot.

-- ---------------------------------------------------------------------------
-- 1. Extend admin_users
-- ---------------------------------------------------------------------------
ALTER TABLE admin_users
  ADD COLUMN job_title VARCHAR(191) NULL AFTER name,
  ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash,
  ADD COLUMN notes TEXT NULL AFTER is_active,
  ADD COLUMN legacy_role VARCHAR(32) NULL AFTER role;

-- Expand role ENUM to include `user` while keeping legacy values for remapping
ALTER TABLE admin_users
  MODIFY COLUMN role ENUM('admin', 'support', 'cfo', 'partner', 'ceo', 'viewer', 'user')
  NOT NULL DEFAULT 'user';

UPDATE admin_users
SET legacy_role = role
WHERE role IN ('support', 'cfo', 'partner', 'ceo', 'viewer')
  AND (legacy_role IS NULL OR legacy_role = '');

UPDATE admin_users
SET role = 'user'
WHERE role IN ('support', 'cfo', 'partner', 'ceo', 'viewer');

ALTER TABLE admin_users
  MODIFY COLUMN role ENUM('admin', 'user') NOT NULL DEFAULT 'user';

-- ---------------------------------------------------------------------------
-- 2. Core RBAC tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rbac_permissions (
  perm_key VARCHAR(96) NOT NULL,
  module_key VARCHAR(64) NOT NULL,
  module_label VARCHAR(128) NOT NULL,
  label VARCHAR(128) NOT NULL,
  description VARCHAR(512) NULL,
  is_dangerous TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (perm_key),
  KEY idx_rbac_permissions_module (module_key),
  KEY idx_rbac_permissions_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rbac_groups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  description VARCHAR(512) NULL,
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rbac_groups_slug (slug),
  KEY idx_rbac_groups_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rbac_group_permissions (
  group_id BIGINT UNSIGNED NOT NULL,
  perm_key VARCHAR(96) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, perm_key),
  KEY idx_rbac_group_perms_key (perm_key),
  CONSTRAINT fk_rbac_group_perms_group
    FOREIGN KEY (group_id) REFERENCES rbac_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_rbac_group_perms_perm
    FOREIGN KEY (perm_key) REFERENCES rbac_permissions(perm_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rbac_user_groups (
  user_id BIGINT UNSIGNED NOT NULL,
  group_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, group_id),
  KEY idx_rbac_user_groups_group (group_id),
  CONSTRAINT fk_rbac_user_groups_user
    FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_rbac_user_groups_group
    FOREIGN KEY (group_id) REFERENCES rbac_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rbac_user_permissions (
  user_id BIGINT UNSIGNED NOT NULL,
  perm_key VARCHAR(96) NOT NULL,
  effect ENUM('grant', 'deny') NOT NULL DEFAULT 'grant',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, perm_key),
  KEY idx_rbac_user_perms_key (perm_key),
  CONSTRAINT fk_rbac_user_perms_user
    FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_rbac_user_perms_perm
    FOREIGN KEY (perm_key) REFERENCES rbac_permissions(perm_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rbac_permission_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id BIGINT UNSIGNED NULL,
  target_user_id BIGINT UNSIGNED NULL,
  target_group_id BIGINT UNSIGNED NULL,
  action VARCHAR(64) NOT NULL,
  previous_state JSON NULL,
  new_state JSON NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(512) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rbac_audit_actor (actor_user_id),
  KEY idx_rbac_audit_target_user (target_user_id),
  KEY idx_rbac_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
