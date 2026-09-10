-- Staff-created leads from the admin Leads page.

ALTER TABLE leads
  MODIFY COLUMN source ENUM(
    'whatsapp',
    'web',
    'embed',
    'email',
    'signup',
    'manual'
  ) NOT NULL;
