-- App-level settings (key/value JSON) for admin-editable configuration

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(128) NOT NULL,
  setting_value JSON NOT NULL,
  updated_by INT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
