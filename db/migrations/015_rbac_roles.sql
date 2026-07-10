ALTER TABLE admin_users
  MODIFY role ENUM('admin', 'viewer', 'support', 'cfo') NOT NULL DEFAULT 'support';

UPDATE admin_users SET role = 'support' WHERE role = 'viewer';

ALTER TABLE admin_users
  MODIFY role ENUM('admin', 'support', 'cfo') NOT NULL DEFAULT 'support';
