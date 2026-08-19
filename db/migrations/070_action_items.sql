-- Reminders / action items with tagged assignees, in-app notifications, and PWA push.

CREATE TABLE IF NOT EXISTS action_types (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  type_key VARCHAR(64) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT NULL,
  requires_customer TINYINT(1) NOT NULL DEFAULT 1,
  notify_customer TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_action_types_key (type_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS action_type_steps (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  action_type_id INT UNSIGNED NOT NULL,
  step_key VARCHAR(64) NOT NULL,
  label VARCHAR(200) NOT NULL,
  description VARCHAR(500) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_action_type_step (action_type_id, step_key),
  KEY idx_action_type_steps_type (action_type_id),
  CONSTRAINT fk_action_type_steps_type
    FOREIGN KEY (action_type_id) REFERENCES action_types(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS action_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  action_type_id INT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  customer_id INT UNSIGNED NULL,
  due_date DATE NULL,
  priority ENUM('low', 'normal', 'high', 'urgent') NOT NULL DEFAULT 'normal',
  status ENUM('open', 'in_progress', 'completed', 'cancelled') NOT NULL DEFAULT 'open',
  created_by BIGINT UNSIGNED NULL,
  completed_at DATETIME NULL,
  completed_by BIGINT UNSIGNED NULL,
  notes TEXT NULL,
  customer_notified_at DATETIME NULL,
  customer_completed_notified_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_action_items_status (status),
  KEY idx_action_items_due (due_date),
  KEY idx_action_items_customer (customer_id),
  KEY idx_action_items_type (action_type_id),
  KEY idx_action_items_created_by (created_by),
  CONSTRAINT fk_action_items_type
    FOREIGN KEY (action_type_id) REFERENCES action_types(id),
  CONSTRAINT fk_action_items_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  CONSTRAINT fk_action_items_created_by
    FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_action_items_completed_by
    FOREIGN KEY (completed_by) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS action_item_steps (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  action_item_id BIGINT UNSIGNED NOT NULL,
  step_key VARCHAR(64) NOT NULL,
  label VARCHAR(200) NOT NULL,
  description VARCHAR(500) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  status ENUM('pending', 'done', 'skipped') NOT NULL DEFAULT 'pending',
  assigned_to BIGINT UNSIGNED NULL,
  completed_at DATETIME NULL,
  completed_by BIGINT UNSIGNED NULL,
  notes TEXT NULL,
  PRIMARY KEY (id),
  KEY idx_action_item_steps_item (action_item_id),
  KEY idx_action_item_steps_assignee (assigned_to),
  CONSTRAINT fk_action_item_steps_item
    FOREIGN KEY (action_item_id) REFERENCES action_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_action_item_steps_assignee
    FOREIGN KEY (assigned_to) REFERENCES admin_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_action_item_steps_completed_by
    FOREIGN KEY (completed_by) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS action_item_assignees (
  action_item_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (action_item_id, user_id),
  KEY idx_action_item_assignees_user (user_id),
  CONSTRAINT fk_action_item_assignees_item
    FOREIGN KEY (action_item_id) REFERENCES action_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_action_item_assignees_user
    FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NULL,
  action_item_id BIGINT UNSIGNED NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_notifications_inbox (user_id, is_read, created_at),
  KEY idx_user_notifications_item (action_item_id),
  CONSTRAINT fk_user_notifications_user
    FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_notifications_item
    FOREIGN KEY (action_item_id) REFERENCES action_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  endpoint TEXT NOT NULL,
  endpoint_hash CHAR(64) NOT NULL,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(128) NOT NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_push_subscriptions_endpoint (endpoint_hash),
  KEY idx_push_subscriptions_user (user_id),
  CONSTRAINT fk_push_subscriptions_user
    FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO action_types (type_key, name, description, requires_customer, notify_customer, sort_order)
VALUES
  ('customer_move_out', 'Customer move-out',
   'Customer is leaving at the end of the period. Cancel service, collect equipment, and free the apartment.',
   1, 1, 10),
  ('customer_move_in', 'Customer move-in / takeover',
   'New tenant taking over a unit. Install or reconnect equipment and confirm service.',
   1, 1, 20),
  ('apartment_switch', 'Apartment switch',
   'Same customer moving to a different unit. Relocate ONU and update records.',
   1, 1, 30),
  ('service_pause', 'Service pause',
   'Customer is away. Pause billing/access and schedule a resume.',
   1, 1, 40),
  ('service_resume', 'Service resume',
   'Restore service after a pause. Activate ONU and confirm the line is working.',
   1, 1, 50),
  ('fault_repair', 'Fault / repair',
   'Investigate and restore a service issue. Visit site or replace equipment if needed.',
   1, 1, 60),
  ('equipment_collection', 'Equipment collection',
   'Collect ONU, router, or other CPE from the customer and restock.',
   1, 1, 70),
  ('collections_followup', 'Collections follow-up',
   'Outstanding balance. Contact the customer, remind, and escalate if unpaid.',
   1, 1, 80),
  ('package_change', 'Package change follow-up',
   'Upgrade or downgrade follow-through: billing, speeds, and customer confirmation.',
   1, 1, 90),
  ('custom', 'Custom reminder',
   'Freeform reminder. Add your own checklist items and tag the people who should act.',
   0, 0, 100);

INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'confirm_move_date', 'Confirm move-out date', 'Agree the last day of service with the customer.', 10
FROM action_types WHERE type_key = 'customer_move_out';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'settle_balance', 'Settle outstanding balance', 'Collect any unpaid invoices before cancellation.', 20
FROM action_types WHERE type_key = 'customer_move_out';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'cancel_subscription', 'Cancel subscription', 'Cancel the subscription and stop recurring billing.', 30
FROM action_types WHERE type_key = 'customer_move_out';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'collect_onu', 'Collect ONU', 'Retrieve the ONU from the apartment.', 40
FROM action_types WHERE type_key = 'customer_move_out';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'collect_router', 'Collect router / CPE', 'Retrieve the router or other customer-premises equipment.', 50
FROM action_types WHERE type_key = 'customer_move_out';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'collect_dstv', 'Collect DStv decoder', 'If the package includes DStv, collect the decoder.', 60
FROM action_types WHERE type_key = 'customer_move_out';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'deactivate_olt', 'Deactivate OLT port', 'Deactivate the ONU on the building OLT.', 70
FROM action_types WHERE type_key = 'customer_move_out';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'release_apartment', 'Release apartment', 'Free the unit so a new tenant can be onboarded.', 80
FROM action_types WHERE type_key = 'customer_move_out';

INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'confirm_unit_ready', 'Confirm unit is ready', 'Check the apartment is vacated and ready for install.', 10
FROM action_types WHERE type_key = 'customer_move_in';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'install_onu', 'Install / reconnect ONU', 'Install or reconnect the ONU in the unit.', 20
FROM action_types WHERE type_key = 'customer_move_in';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'activate_service', 'Activate service', 'Activate access on TISP / OLT.', 30
FROM action_types WHERE type_key = 'customer_move_in';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'confirm_first_payment', 'Confirm first payment', 'Confirm signup or first-period payment is in.', 40
FROM action_types WHERE type_key = 'customer_move_in';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'welcome_customer', 'Welcome the customer', 'Confirm the line is working and the customer has support contacts.', 50
FROM action_types WHERE type_key = 'customer_move_in';

INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'collect_onu_old', 'Collect ONU from old unit', 'Retrieve the ONU from the previous apartment.', 10
FROM action_types WHERE type_key = 'apartment_switch';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'install_onu_new', 'Install ONU in new unit', 'Install and light the ONU in the new apartment.', 20
FROM action_types WHERE type_key = 'apartment_switch';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'update_records', 'Update customer records', 'Move apartment, customer number, and history.', 30
FROM action_types WHERE type_key = 'apartment_switch';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'relink_olt', 'Relink OLT / ONU', 'Link the new ONU index and serial on the building OLT.', 40
FROM action_types WHERE type_key = 'apartment_switch';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'confirm_service', 'Confirm service working', 'Test the line with the customer in the new unit.', 50
FROM action_types WHERE type_key = 'apartment_switch';

INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'confirm_pause_dates', 'Confirm pause dates', 'Agree start and end dates with the customer.', 10
FROM action_types WHERE type_key = 'service_pause';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'pause_subscription', 'Pause subscription', 'Pause access and defer billing for the window.', 20
FROM action_types WHERE type_key = 'service_pause';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'deactivate_onu', 'Deactivate ONU', 'Deactivate the ONU on the OLT while paused.', 30
FROM action_types WHERE type_key = 'service_pause';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'schedule_resume', 'Schedule resume reminder', 'Create or note the resume date so service is restored on time.', 40
FROM action_types WHERE type_key = 'service_pause';

INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'resume_subscription', 'Resume subscription', 'Restore billing and access after the pause.', 10
FROM action_types WHERE type_key = 'service_resume';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'activate_onu', 'Activate ONU', 'Re-activate the ONU on the building OLT.', 20
FROM action_types WHERE type_key = 'service_resume';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'confirm_line', 'Confirm line is working', 'Test connectivity with the customer.', 30
FROM action_types WHERE type_key = 'service_resume';

INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'diagnose', 'Diagnose the issue', 'Identify whether the fault is CPE, drop, or OLT.', 10
FROM action_types WHERE type_key = 'fault_repair';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'site_visit', 'Site visit', 'Visit the apartment if remote checks do not restore service.', 20
FROM action_types WHERE type_key = 'fault_repair';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'replace_equipment', 'Replace ONU / equipment', 'Swap faulty ONU or CPE if needed.', 30
FROM action_types WHERE type_key = 'fault_repair';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'confirm_restored', 'Confirm service restored', 'Verify the customer is back online.', 40
FROM action_types WHERE type_key = 'fault_repair';

INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'collect_onu', 'Collect ONU', 'Retrieve the ONU from the customer.', 10
FROM action_types WHERE type_key = 'equipment_collection';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'collect_router', 'Collect router / CPE', 'Retrieve the router or other equipment.', 20
FROM action_types WHERE type_key = 'equipment_collection';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'inspect_restock', 'Inspect and restock', 'Check condition and return gear to stock.', 30
FROM action_types WHERE type_key = 'equipment_collection';

INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'contact_customer', 'Contact the customer', 'Call or message about the outstanding balance.', 10
FROM action_types WHERE type_key = 'collections_followup';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'send_reminder', 'Send payment reminder', 'Send a billing reminder if still unpaid.', 20
FROM action_types WHERE type_key = 'collections_followup';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'arrange_plan', 'Arrange payment plan', 'Agree a settlement date or plan if needed.', 30
FROM action_types WHERE type_key = 'collections_followup';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'escalate_suspend', 'Escalate / suspend if unpaid', 'Follow collections policy if payment is not received.', 40
FROM action_types WHERE type_key = 'collections_followup';

INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'process_change', 'Process package change', 'Apply the upgrade or downgrade on the account.', 10
FROM action_types WHERE type_key = 'package_change';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'confirm_billing', 'Confirm billing updated', 'Check Zoho recurring / invoice matches the new package.', 20
FROM action_types WHERE type_key = 'package_change';
INSERT INTO action_type_steps (action_type_id, step_key, label, description, sort_order)
SELECT id, 'confirm_speeds', 'Confirm speeds applied', 'Verify the customer is on the new package speeds.', 30
FROM action_types WHERE type_key = 'package_change';
