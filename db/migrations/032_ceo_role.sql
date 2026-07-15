-- Executive (CEO) role: read-only financial visibility — reports, BI, customers & payments.
ALTER TABLE admin_users
  MODIFY role ENUM('admin', 'support', 'cfo', 'partner', 'ceo') NOT NULL DEFAULT 'support';
