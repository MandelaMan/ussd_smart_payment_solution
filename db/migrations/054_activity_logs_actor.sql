-- Attribute activity feed entries to the admin user who performed the action.
ALTER TABLE activity_logs
  ADD COLUMN actor_user_id BIGINT UNSIGNED NULL AFTER metadata,
  ADD COLUMN actor_name VARCHAR(191) NULL AFTER actor_user_id,
  ADD KEY idx_activity_actor (actor_user_id);
