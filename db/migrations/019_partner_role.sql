ALTER TABLE admin_users
  MODIFY role ENUM('admin', 'support', 'cfo', 'partner') NOT NULL DEFAULT 'support';
