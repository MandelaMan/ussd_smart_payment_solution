-- Allow login audit trail to record account-recovery requests.

ALTER TABLE auth_login_logs
  MODIFY COLUMN outcome ENUM('success', 'failure', 'logout', 'lockout', 'recovery') NOT NULL;
