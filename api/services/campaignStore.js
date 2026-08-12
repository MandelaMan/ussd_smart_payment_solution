const { query } = require("../config/db");

function mapCampaign(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    newCustomerDiscountPercent: Number(row.new_customer_discount_percent),
    referrerRewardPercent: Number(row.referrer_reward_percent),
    appliesToDecoder: Boolean(row.applies_to_decoder),
    priority: Number(row.priority != null ? row.priority : 100),
    description: row.description || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metrics: row._metrics || undefined,
  };
}

function mapAttribution(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    campaignId: Number(row.campaign_id),
    refereeCustomerId: Number(row.referee_customer_id),
    referrerCustomerId: Number(row.referrer_customer_id),
    status: row.status,
    signupInvoiceId: row.signup_invoice_id || null,
    qualifiedAt: row.qualified_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    campaignCode: row.campaign_code || null,
    campaignName: row.campaign_name || null,
    referrerRewardPercent:
      row.referrer_reward_percent != null
        ? Number(row.referrer_reward_percent)
        : null,
    newCustomerDiscountPercent:
      row.new_customer_discount_percent != null
        ? Number(row.new_customer_discount_percent)
        : null,
    appliesToDecoder:
      row.applies_to_decoder != null ? Boolean(row.applies_to_decoder) : null,
    refereeCustomerNumber: row.referee_customer_number || null,
    referrerCustomerNumber: row.referrer_customer_number || null,
  };
}

function mapReward(row) {
  if (!row) return null;
  let originalRates = null;
  let discountedRates = null;
  try {
    originalRates =
      typeof row.original_rates_json === "string"
        ? JSON.parse(row.original_rates_json)
        : row.original_rates_json || null;
  } catch {
    originalRates = null;
  }
  try {
    discountedRates =
      typeof row.discounted_rates_json === "string"
        ? JSON.parse(row.discounted_rates_json)
        : row.discounted_rates_json || null;
  } catch {
    discountedRates = null;
  }
  return {
    id: Number(row.id),
    attributionId: Number(row.attribution_id),
    referrerCustomerId: Number(row.referrer_customer_id),
    campaignId: Number(row.campaign_id),
    rewardPercent: Number(row.reward_percent),
    status: row.status,
    queueOrder: Number(row.queue_order || 1),
    zohoRecurringInvoiceId: row.zoho_recurring_invoice_id || null,
    originalRates,
    discountedRates,
    childInvoiceId: row.child_invoice_id || null,
    childInvoiceNumber: row.child_invoice_number || null,
    appliedAt: row.applied_at,
    restoreAfter: row.restore_after,
    restoredAt: row.restored_at,
    emailNotifiedAt: row.email_notified_at,
    lastError: row.last_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapApplication(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    campaignId: Number(row.campaign_id),
    customerId: Number(row.customer_id),
    discountPercent: Number(row.discount_percent),
    packageListPrice: Number(row.package_list_price),
    packageDiscountAmount: Number(row.package_discount_amount),
    signupInvoiceId: row.signup_invoice_id || null,
    signupInvoiceNumber: row.signup_invoice_number || null,
    appliedAt: row.applied_at,
    campaignCode: row.campaign_code || null,
    campaignName: row.campaign_name || null,
  };
}

function normalizePercent(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  if (n > 100) return 100;
  return Math.round(n * 1000) / 1000;
}

/**
 * Active campaigns at a point in time (supports concurrent campaigns).
 * Ordered by priority DESC, then starts_at DESC.
 */
async function listActiveCampaigns({ at = new Date() } = {}) {
  const atDate = at instanceof Date ? at : new Date(at);
  const rows = await query(
    `SELECT * FROM campaigns
     WHERE status = 'active'
       AND starts_at IS NOT NULL
       AND ends_at IS NOT NULL
       AND starts_at <= ?
       AND ends_at >= ?
     ORDER BY priority DESC, starts_at DESC, id DESC`,
    [atDate, atDate]
  );
  return rows.map(mapCampaign);
}

/**
 * Active campaign at a point in time (default now).
 * Prefer explicit campaignId/code when provided; otherwise highest priority live campaign.
 */
async function resolveActiveCampaign({
  campaignId = null,
  campaignCode = null,
  at = new Date(),
} = {}) {
  const atDate = at instanceof Date ? at : new Date(at);
  if (campaignId) {
    const rows = await query(
      `SELECT * FROM campaigns WHERE id = ? LIMIT 1`,
      [Number(campaignId)]
    );
    const campaign = mapCampaign(rows[0]);
    if (campaign && isCampaignActive(campaign, atDate)) return campaign;
    return null;
  }
  if (campaignCode) {
    const rows = await query(
      `SELECT * FROM campaigns WHERE code = ? LIMIT 1`,
      [String(campaignCode).trim().toUpperCase()]
    );
    const campaign = mapCampaign(rows[0]);
    if (campaign && isCampaignActive(campaign, atDate)) return campaign;
    return null;
  }

  const active = await listActiveCampaigns({ at: atDate });
  return active[0] || null;
}

function isCampaignActive(campaign, at = new Date()) {
  if (!campaign || campaign.status !== "active") return false;
  if (!campaign.startsAt || !campaign.endsAt) return false;
  const t = at.getTime();
  const start = new Date(campaign.startsAt).getTime();
  const end = new Date(campaign.endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (t < start || t > end) return false;
  return true;
}

function assertCampaignDates({ startsAt, endsAt }) {
  if (!startsAt) {
    const err = new Error("Start date is required");
    err.code = "CAMPAIGN_START_REQUIRED";
    throw err;
  }
  if (!endsAt) {
    const err = new Error("End date is required");
    err.code = "CAMPAIGN_END_REQUIRED";
    throw err;
  }
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    const err = new Error("Campaign dates are invalid");
    err.code = "CAMPAIGN_DATES_INVALID";
    throw err;
  }
  if (end.getTime() < start.getTime()) {
    const err = new Error("End date must be on or after the start date");
    err.code = "CAMPAIGN_DATE_RANGE";
    throw err;
  }
}

async function listCampaigns({ status = null, includeMetrics = false } = {}) {
  const params = [];
  let sql = `SELECT * FROM campaigns`;
  if (status) {
    sql += ` WHERE status = ?`;
    params.push(String(status));
  }
  sql += ` ORDER BY priority DESC, starts_at DESC, id DESC`;
  const rows = await query(sql, params);
  const campaigns = rows.map(mapCampaign);
  if (!includeMetrics || !campaigns.length) return campaigns;

  const metricsById = await getCampaignMetricsMap(
    campaigns.map((c) => c.id)
  );
  return campaigns.map((c) => ({
    ...c,
    metrics: metricsById.get(c.id) || emptyMetrics(),
  }));
}

function emptyMetrics() {
  return {
    applications: 0,
    discountAmountTotal: 0,
    referralsPending: 0,
    referralsQualified: 0,
    referralsRewarded: 0,
    referralsCancelled: 0,
    rewardsQueued: 0,
    rewardsApplied: 0,
    rewardsRestored: 0,
    rewardsFailed: 0,
  };
}

async function getCampaignMetricsMap(campaignIds = []) {
  const ids = [...new Set(campaignIds.map(Number).filter((n) => n > 0))];
  const map = new Map();
  for (const id of ids) map.set(id, emptyMetrics());
  if (!ids.length) return map;

  const placeholders = ids.map(() => "?").join(",");

  const appRows = await query(
    `SELECT campaign_id,
            COUNT(*) AS applications,
            COALESCE(SUM(package_discount_amount), 0) AS discount_amount_total
     FROM campaign_applications
     WHERE campaign_id IN (${placeholders})
     GROUP BY campaign_id`,
    ids
  );
  for (const row of appRows) {
    const m = map.get(Number(row.campaign_id)) || emptyMetrics();
    m.applications = Number(row.applications) || 0;
    m.discountAmountTotal = Number(row.discount_amount_total) || 0;
    map.set(Number(row.campaign_id), m);
  }

  const attrRows = await query(
    `SELECT campaign_id, status, COUNT(*) AS cnt
     FROM referral_attributions
     WHERE campaign_id IN (${placeholders})
     GROUP BY campaign_id, status`,
    ids
  );
  for (const row of attrRows) {
    const m = map.get(Number(row.campaign_id)) || emptyMetrics();
    const n = Number(row.cnt) || 0;
    if (row.status === "pending_payment") m.referralsPending = n;
    else if (row.status === "qualified") m.referralsQualified = n;
    else if (row.status === "rewarded") m.referralsRewarded = n;
    else if (row.status === "cancelled") m.referralsCancelled = n;
    map.set(Number(row.campaign_id), m);
  }

  const rewardRows = await query(
    `SELECT campaign_id, status, COUNT(*) AS cnt
     FROM referral_rewards
     WHERE campaign_id IN (${placeholders})
     GROUP BY campaign_id, status`,
    ids
  );
  for (const row of rewardRows) {
    const m = map.get(Number(row.campaign_id)) || emptyMetrics();
    const n = Number(row.cnt) || 0;
    if (row.status === "queued") m.rewardsQueued = n;
    else if (row.status === "applied") m.rewardsApplied = n;
    else if (row.status === "restored") m.rewardsRestored = n;
    else if (row.status === "failed") m.rewardsFailed = n;
    map.set(Number(row.campaign_id), m);
  }

  return map;
}

async function getCampaignMetrics(campaignId) {
  const map = await getCampaignMetricsMap([Number(campaignId)]);
  return map.get(Number(campaignId)) || emptyMetrics();
}

async function getCampaignById(id) {
  const rows = await query(`SELECT * FROM campaigns WHERE id = ? LIMIT 1`, [
    Number(id),
  ]);
  return mapCampaign(rows[0]);
}

async function createCampaign(input = {}) {
  const code = String(input.code || "")
    .trim()
    .toUpperCase();
  if (!code) throw new Error("Campaign code is required");
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Campaign name is required");
  const status = ["draft", "active", "paused", "ended"].includes(input.status)
    ? input.status
    : "draft";
  const startsAt = input.startsAt ? new Date(input.startsAt) : null;
  const endsAt = input.endsAt ? new Date(input.endsAt) : null;
  assertCampaignDates({ startsAt, endsAt });
  const result = await query(
    `INSERT INTO campaigns (
      code, name, status, starts_at, ends_at,
      new_customer_discount_percent, referrer_reward_percent,
      applies_to_decoder, priority, description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      code,
      name,
      status,
      startsAt,
      endsAt,
      normalizePercent(input.newCustomerDiscountPercent, 50),
      normalizePercent(input.referrerRewardPercent, 10),
      input.appliesToDecoder === true ? 1 : 0,
      Number.isFinite(Number(input.priority)) ? Number(input.priority) : 100,
      input.description || null,
    ]
  );
  return getCampaignById(result.insertId);
}

async function updateCampaign(id, input = {}) {
  const existing = await getCampaignById(id);
  if (!existing) return null;
  const name =
    input.name != null ? String(input.name).trim() : existing.name;
  const status = ["draft", "active", "paused", "ended"].includes(input.status)
    ? input.status
    : existing.status;
  const startsAt =
    input.startsAt != null ? new Date(input.startsAt) : existing.startsAt;
  if (input.endsAt === null || input.endsAt === "") {
    const err = new Error("End date is required");
    err.code = "CAMPAIGN_END_REQUIRED";
    throw err;
  }
  const endsAt =
    input.endsAt != null ? new Date(input.endsAt) : existing.endsAt;
  assertCampaignDates({ startsAt, endsAt });
  await query(
    `UPDATE campaigns SET
      name = ?,
      status = ?,
      starts_at = ?,
      ends_at = ?,
      new_customer_discount_percent = ?,
      referrer_reward_percent = ?,
      applies_to_decoder = ?,
      priority = ?,
      description = ?
     WHERE id = ?`,
    [
      name,
      status,
      startsAt,
      endsAt,
      normalizePercent(
        input.newCustomerDiscountPercent,
        existing.newCustomerDiscountPercent
      ),
      normalizePercent(
        input.referrerRewardPercent,
        existing.referrerRewardPercent
      ),
      input.appliesToDecoder != null
        ? input.appliesToDecoder
          ? 1
          : 0
        : existing.appliesToDecoder
          ? 1
          : 0,
      input.priority != null && Number.isFinite(Number(input.priority))
        ? Number(input.priority)
        : existing.priority,
      input.description !== undefined
        ? input.description
        : existing.description,
      Number(id),
    ]
  );
  return getCampaignById(id);
}

async function deleteCampaign(id) {
  const campaign = await getCampaignById(id);
  if (!campaign) return null;

  const campaignId = Number(id);
  const [appCount] = await query(
    `SELECT COUNT(*) AS c FROM campaign_applications WHERE campaign_id = ?`,
    [campaignId]
  );
  const [attrCount] = await query(
    `SELECT COUNT(*) AS c FROM referral_attributions WHERE campaign_id = ?`,
    [campaignId]
  );
  const [rewardCount] = await query(
    `SELECT COUNT(*) AS c FROM referral_rewards WHERE campaign_id = ?`,
    [campaignId]
  );
  const used =
    Number(appCount?.c || 0) +
    Number(attrCount?.c || 0) +
    Number(rewardCount?.c || 0);
  if (used > 0) {
    const err = new Error(
      "Cannot delete a campaign with signup or referral history. Pause or end it instead."
    );
    err.code = "CAMPAIGN_HAS_HISTORY";
    throw err;
  }

  await query(`UPDATE customers SET campaign_id = NULL WHERE campaign_id = ?`, [
    campaignId,
  ]);
  await query(`DELETE FROM campaigns WHERE id = ?`, [campaignId]);
  return campaign;
}

async function getApplicationForCustomer(customerId) {
  const rows = await query(
    `SELECT a.*, c.code AS campaign_code, c.name AS campaign_name
     FROM campaign_applications a
     JOIN campaigns c ON c.id = a.campaign_id
     WHERE a.customer_id = ?
     LIMIT 1`,
    [Number(customerId)]
  );
  return mapApplication(rows[0]);
}

async function recordCampaignApplication({
  campaignId,
  customerId,
  discountPercent,
  packageListPrice,
  packageDiscountAmount,
  signupInvoiceId = null,
  signupInvoiceNumber = null,
}) {
  await query(
    `INSERT INTO campaign_applications (
      campaign_id, customer_id, discount_percent,
      package_list_price, package_discount_amount,
      signup_invoice_id, signup_invoice_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      discount_percent = VALUES(discount_percent),
      package_list_price = VALUES(package_list_price),
      package_discount_amount = VALUES(package_discount_amount),
      signup_invoice_id = COALESCE(VALUES(signup_invoice_id), signup_invoice_id),
      signup_invoice_number = COALESCE(VALUES(signup_invoice_number), signup_invoice_number)`,
    [
      Number(campaignId),
      Number(customerId),
      normalizePercent(discountPercent),
      Number(packageListPrice) || 0,
      Number(packageDiscountAmount) || 0,
      signupInvoiceId || null,
      signupInvoiceNumber || null,
    ]
  );
  return getApplicationForCustomer(customerId);
}

async function updateApplicationInvoice(customerId, invoiceId, invoiceNumber) {
  await query(
    `UPDATE campaign_applications
     SET signup_invoice_id = ?, signup_invoice_number = ?
     WHERE customer_id = ?`,
    [invoiceId || null, invoiceNumber || null, Number(customerId)]
  );
}

async function getAttributionForReferee(refereeCustomerId) {
  const rows = await query(
    `SELECT a.*,
            c.code AS campaign_code,
            c.name AS campaign_name,
            c.referrer_reward_percent,
            c.new_customer_discount_percent,
            c.applies_to_decoder,
            ref.customer_number AS referee_customer_number,
            r.customer_number AS referrer_customer_number
     FROM referral_attributions a
     JOIN campaigns c ON c.id = a.campaign_id
     JOIN customers ref ON ref.id = a.referee_customer_id
     JOIN customers r ON r.id = a.referrer_customer_id
     WHERE a.referee_customer_id = ?
     LIMIT 1`,
    [Number(refereeCustomerId)]
  );
  return mapAttribution(rows[0]);
}

async function createAttribution({
  campaignId,
  refereeCustomerId,
  referrerCustomerId,
  signupInvoiceId = null,
}) {
  await query(
    `INSERT INTO referral_attributions (
      campaign_id, referee_customer_id, referrer_customer_id,
      status, signup_invoice_id
    ) VALUES (?, ?, ?, 'pending_payment', ?)
    ON DUPLICATE KEY UPDATE
      campaign_id = VALUES(campaign_id),
      referrer_customer_id = VALUES(referrer_customer_id),
      signup_invoice_id = COALESCE(VALUES(signup_invoice_id), signup_invoice_id),
      status = IF(status = 'cancelled', 'pending_payment', status),
      cancelled_at = NULL,
      cancel_reason = NULL`,
    [
      Number(campaignId),
      Number(refereeCustomerId),
      Number(referrerCustomerId),
      signupInvoiceId || null,
    ]
  );
  return getAttributionForReferee(refereeCustomerId);
}

async function markAttributionQualified(attributionId, { signupInvoiceId } = {}) {
  await query(
    `UPDATE referral_attributions
     SET status = 'qualified',
         qualified_at = UTC_TIMESTAMP(),
         signup_invoice_id = COALESCE(?, signup_invoice_id)
     WHERE id = ? AND status = 'pending_payment'`,
    [signupInvoiceId || null, Number(attributionId)]
  );
  const rows = await query(
    `SELECT a.*,
            c.code AS campaign_code,
            c.name AS campaign_name,
            c.referrer_reward_percent,
            c.new_customer_discount_percent,
            c.applies_to_decoder
     FROM referral_attributions a
     JOIN campaigns c ON c.id = a.campaign_id
     WHERE a.id = ?
     LIMIT 1`,
    [Number(attributionId)]
  );
  return mapAttribution(rows[0]);
}

async function markAttributionRewarded(attributionId) {
  await query(
    `UPDATE referral_attributions
     SET status = 'rewarded'
     WHERE id = ?`,
    [Number(attributionId)]
  );
}

async function cancelAttribution(attributionId, reason) {
  await query(
    `UPDATE referral_attributions
     SET status = 'cancelled',
         cancelled_at = UTC_TIMESTAMP(),
         cancel_reason = ?
     WHERE id = ? AND status IN ('pending_payment', 'qualified')`,
    [String(reason || "cancelled").slice(0, 255), Number(attributionId)]
  );
}

async function nextRewardQueueOrder(referrerCustomerId) {
  const rows = await query(
    `SELECT COALESCE(MAX(queue_order), 0) AS max_order
     FROM referral_rewards
     WHERE referrer_customer_id = ?
       AND status IN ('queued', 'applied')`,
    [Number(referrerCustomerId)]
  );
  return Number(rows[0]?.max_order || 0) + 1;
}

async function createReward({
  attributionId,
  referrerCustomerId,
  campaignId,
  rewardPercent,
  status = "queued",
}) {
  const queueOrder = await nextRewardQueueOrder(referrerCustomerId);
  const result = await query(
    `INSERT INTO referral_rewards (
      attribution_id, referrer_customer_id, campaign_id,
      reward_percent, status, queue_order
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      Number(attributionId),
      Number(referrerCustomerId),
      Number(campaignId),
      normalizePercent(rewardPercent),
      status,
      queueOrder,
    ]
  );
  return getRewardById(result.insertId);
}

async function getRewardById(id) {
  const rows = await query(
    `SELECT * FROM referral_rewards WHERE id = ? LIMIT 1`,
    [Number(id)]
  );
  return mapReward(rows[0]);
}

async function getRewardByAttributionId(attributionId) {
  const rows = await query(
    `SELECT * FROM referral_rewards WHERE attribution_id = ? LIMIT 1`,
    [Number(attributionId)]
  );
  return mapReward(rows[0]);
}

async function getAppliedRewardForReferrer(referrerCustomerId) {
  const rows = await query(
    `SELECT * FROM referral_rewards
     WHERE referrer_customer_id = ? AND status = 'applied'
     ORDER BY queue_order ASC, id ASC
     LIMIT 1`,
    [Number(referrerCustomerId)]
  );
  return mapReward(rows[0]);
}

async function getNextQueuedReward(referrerCustomerId) {
  const rows = await query(
    `SELECT * FROM referral_rewards
     WHERE referrer_customer_id = ? AND status = 'queued'
     ORDER BY queue_order ASC, id ASC
     LIMIT 1`,
    [Number(referrerCustomerId)]
  );
  return mapReward(rows[0]);
}

async function listAppliedRewardsDueForRestore(limit = 50) {
  const rows = await query(
    `SELECT * FROM referral_rewards
     WHERE status = 'applied'
       AND (
         restore_after IS NULL
         OR restore_after <= UTC_DATE()
       )
     ORDER BY applied_at ASC, id ASC
     LIMIT ?`,
    [Number(limit) || 50]
  );
  return rows.map(mapReward);
}

async function markRewardApplied(rewardId, payload = {}) {
  await query(
    `UPDATE referral_rewards SET
      status = 'applied',
      zoho_recurring_invoice_id = ?,
      original_rates_json = ?,
      discounted_rates_json = ?,
      applied_at = UTC_TIMESTAMP(),
      restore_after = ?,
      last_error = NULL
     WHERE id = ?`,
    [
      payload.zohoRecurringInvoiceId || null,
      JSON.stringify(payload.originalRates || null),
      JSON.stringify(payload.discountedRates || null),
      payload.restoreAfter || null,
      Number(rewardId),
    ]
  );
  return getRewardById(rewardId);
}

async function markRewardRestored(rewardId, payload = {}) {
  await query(
    `UPDATE referral_rewards SET
      status = 'restored',
      child_invoice_id = COALESCE(?, child_invoice_id),
      child_invoice_number = COALESCE(?, child_invoice_number),
      restored_at = UTC_TIMESTAMP(),
      last_error = NULL
     WHERE id = ?`,
    [
      payload.childInvoiceId || null,
      payload.childInvoiceNumber || null,
      Number(rewardId),
    ]
  );
  return getRewardById(rewardId);
}

async function markRewardFailed(rewardId, error) {
  await query(
    `UPDATE referral_rewards SET
      status = IF(status = 'queued', 'failed', status),
      last_error = ?
     WHERE id = ?`,
    [String(error || "failed").slice(0, 500), Number(rewardId)]
  );
  return getRewardById(rewardId);
}

async function markRewardEmailNotified(rewardId) {
  await query(
    `UPDATE referral_rewards SET email_notified_at = UTC_TIMESTAMP() WHERE id = ?`,
    [Number(rewardId)]
  );
}

async function setCustomerCampaignLinks(customerId, {
  campaignId = null,
  referredByCustomerId = null,
} = {}) {
  await query(
    `UPDATE customers
     SET campaign_id = COALESCE(?, campaign_id),
         referred_by_customer_id = COALESCE(?, referred_by_customer_id)
     WHERE id = ?`,
    [
      campaignId != null ? Number(campaignId) : null,
      referredByCustomerId != null ? Number(referredByCustomerId) : null,
      Number(customerId),
    ]
  );
}

module.exports = {
  mapCampaign,
  isCampaignActive,
  listActiveCampaigns,
  resolveActiveCampaign,
  listCampaigns,
  getCampaignById,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  getCampaignMetrics,
  getCampaignMetricsMap,
  emptyMetrics,
  getApplicationForCustomer,
  recordCampaignApplication,
  updateApplicationInvoice,
  getAttributionForReferee,
  createAttribution,
  markAttributionQualified,
  markAttributionRewarded,
  cancelAttribution,
  createReward,
  getRewardById,
  getRewardByAttributionId,
  getAppliedRewardForReferrer,
  getNextQueuedReward,
  listAppliedRewardsDueForRestore,
  markRewardApplied,
  markRewardRestored,
  markRewardFailed,
  markRewardEmailNotified,
  setCustomerCampaignLinks,
  assertCampaignDates,
  normalizePercent,
};
