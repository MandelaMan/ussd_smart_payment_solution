-- Public customer signup: interested (pending conversion) status + signup source.
-- New ENUM members are appended so existing integer mappings stay intact.

ALTER TABLE leads
  MODIFY COLUMN status ENUM(
    'new',
    'contacted',
    'qualified',
    'converted',
    'closed',
    'interested'
  ) NOT NULL DEFAULT 'new';

ALTER TABLE leads
  MODIFY COLUMN source ENUM(
    'whatsapp',
    'web',
    'embed',
    'email',
    'signup'
  ) NOT NULL;
