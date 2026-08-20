-- Per-reminder activity trail: who changed what, and when.

CREATE TABLE IF NOT EXISTS action_item_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  action_item_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  message VARCHAR(500) NOT NULL,
  detail TEXT NULL,
  metadata JSON NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  actor_name VARCHAR(191) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_action_item_events_item (action_item_id, created_at),
  CONSTRAINT fk_action_item_events_item
    FOREIGN KEY (action_item_id) REFERENCES action_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_action_item_events_actor
    FOREIGN KEY (actor_user_id) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
