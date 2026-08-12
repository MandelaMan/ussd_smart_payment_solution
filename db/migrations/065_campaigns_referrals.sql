-- Acquisition campaigns: first-month package discount + referral rewards.
-- New-customer discount applies at onboard (signup invoice). Decoder is never discounted.
-- Referrer one-cycle recurring discount applies only after referee signup invoice is paid.

CREATE TABLE IF NOT EXISTS campaigns (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(200) NOT NULL,
  status ENUM('draft', 'active', 'ended') NOT NULL DEFAULT 'draft',
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NULL,
  new_customer_discount_percent DECIMAL(6, 3) NOT NULL DEFAULT 50.000,
  referrer_reward_percent DECIMAL(6, 3) NOT NULL DEFAULT 10.000,
  applies_to_decoder TINYINT(1) NOT NULL DEFAULT 0,
  description TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_campaigns_code (code),
  KEY idx_campaigns_status_dates (status, starts_at, ends_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS campaign_applications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id INT UNSIGNED NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  discount_percent DECIMAL(6, 3) NOT NULL,
  package_list_price DECIMAL(12, 2) NOT NULL,
  package_discount_amount DECIMAL(12, 2) NOT NULL,
  signup_invoice_id VARCHAR(64) NULL,
  signup_invoice_number VARCHAR(64) NULL,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_campaign_app_customer (customer_id),
  KEY idx_campaign_app_campaign (campaign_id),
  CONSTRAINT fk_campaign_app_campaign
    FOREIGN KEY (campaign_id) REFERENCES campaigns (id),
  CONSTRAINT fk_campaign_app_customer
    FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS referral_attributions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id INT UNSIGNED NOT NULL,
  referee_customer_id INT UNSIGNED NOT NULL,
  referrer_customer_id INT UNSIGNED NOT NULL,
  status ENUM(
    'pending_payment',
    'qualified',
    'rewarded',
    'cancelled'
  ) NOT NULL DEFAULT 'pending_payment',
  signup_invoice_id VARCHAR(64) NULL,
  qualified_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  cancel_reason VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_referral_attr_referee (referee_customer_id),
  KEY idx_referral_attr_referrer_status (referrer_customer_id, status),
  KEY idx_referral_attr_campaign (campaign_id),
  CONSTRAINT fk_referral_attr_campaign
    FOREIGN KEY (campaign_id) REFERENCES campaigns (id),
  CONSTRAINT fk_referral_attr_referee
    FOREIGN KEY (referee_customer_id) REFERENCES customers (id) ON DELETE CASCADE,
  CONSTRAINT fk_referral_attr_referrer
    FOREIGN KEY (referrer_customer_id) REFERENCES customers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS referral_rewards (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  attribution_id BIGINT UNSIGNED NOT NULL,
  referrer_customer_id INT UNSIGNED NOT NULL,
  campaign_id INT UNSIGNED NOT NULL,
  reward_percent DECIMAL(6, 3) NOT NULL,
  status ENUM(
    'queued',
    'applied',
    'restored',
    'failed',
    'cancelled'
  ) NOT NULL DEFAULT 'queued',
  queue_order INT UNSIGNED NOT NULL DEFAULT 1,
  zoho_recurring_invoice_id VARCHAR(64) NULL,
  original_rates_json JSON NULL,
  discounted_rates_json JSON NULL,
  child_invoice_id VARCHAR(64) NULL,
  child_invoice_number VARCHAR(64) NULL,
  applied_at DATETIME NULL,
  restore_after DATE NULL,
  restored_at DATETIME NULL,
  email_notified_at DATETIME NULL,
  last_error VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_referral_reward_attribution (attribution_id),
  KEY idx_referral_reward_referrer_status (referrer_customer_id, status, queue_order),
  KEY idx_referral_reward_restore (status, restore_after),
  CONSTRAINT fk_referral_reward_attribution
    FOREIGN KEY (attribution_id) REFERENCES referral_attributions (id) ON DELETE CASCADE,
  CONSTRAINT fk_referral_reward_referrer
    FOREIGN KEY (referrer_customer_id) REFERENCES customers (id),
  CONSTRAINT fk_referral_reward_campaign
    FOREIGN KEY (campaign_id) REFERENCES campaigns (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE customers
  ADD COLUMN referred_by_customer_id INT UNSIGNED NULL AFTER trial_ends_at,
  ADD COLUMN campaign_id INT UNSIGNED NULL AFTER referred_by_customer_id,
  ADD KEY idx_customers_referred_by (referred_by_customer_id),
  ADD KEY idx_customers_campaign (campaign_id),
  ADD CONSTRAINT fk_customers_referred_by
    FOREIGN KEY (referred_by_customer_id) REFERENCES customers (id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_customers_campaign
    FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE SET NULL;

-- Default launch campaign (activate/edit dates as needed).
INSERT INTO campaigns (
  code,
  name,
  status,
  starts_at,
  ends_at,
  new_customer_discount_percent,
  referrer_reward_percent,
  applies_to_decoder,
  description
) VALUES (
  'LAUNCH50',
  'Launch 50% first month',
  'active',
  UTC_TIMESTAMP(),
  NULL,
  50.000,
  10.000,
  0,
  'New C2B customers (non-trial) get 50% off the package on the first invoice. Referrers get a one-cycle discount after the referee pays.'
);
