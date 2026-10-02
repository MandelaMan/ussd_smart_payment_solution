-- When a staff note was last saved, so the notes list can sort by recent edits.
ALTER TABLE customers
  ADD COLUMN staff_notes_updated_at DATETIME NULL AFTER staff_notes;

INSERT INTO action_types (type_key, name, description, requires_customer, notify_customer, sort_order)
VALUES
  ('note_followup', 'Note follow-up',
   'Follow up on an internal customer note. Not emailed to the customer.',
   1, 0, 95);

INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'follow_up', 'Follow up', 'Act on the customer note and close this reminder.', 10
FROM action_types WHERE type_key = 'note_followup';
