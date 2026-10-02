-- Move the built-in administrator login from admin@ to it@.
-- No-op when it@ already exists. Password is unchanged.

UPDATE admin_users
SET
  email = 'it@sulsolutions.biz',
  name = IF(
    LOWER(TRIM(name)) IN ('admin', 'administrator'),
    'IT',
    name
  ),
  token_version = token_version + 1
WHERE email = 'admin@sulsolutions.biz'
  AND (
    SELECT COUNT(*) FROM (
      SELECT id FROM admin_users WHERE email = 'it@sulsolutions.biz'
    ) AS existing_it
  ) = 0;

UPDATE admin_users
SET name = 'IT'
WHERE email = 'it@sulsolutions.biz'
  AND LOWER(TRIM(name)) IN ('admin', 'administrator');
