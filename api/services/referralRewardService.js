/**
 * Referral reward lifecycle:
 * 1) Attribution at onboard (pending_payment)
 * 2) Qualify when referee signup invoice is paid
 * 3) Apply one-cycle Zoho recurring rate discount (or queue if already applied)
 * 4) Restore full rates after the discounted child invoice cycle, then drain queue
 * 5) Email referrer when discount is applied
 */
const moment = require("moment-timezone");
const campaignStore = require("./campaignStore");
const customerStore = require("./customerModuleStore");
const { logActivity } = require("./activityLogStore");
const { DEFAULT_TZ } = require("../utils/billingPeriod");
const {
  getRecurringInvoices_JS,
  getRecurringInvoice_JS,
  updateRecurringInvoice_JS,
  getInvoices_JS,
} = require("../controllers/zoho.controller");

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function discountRate(rate, percent) {
  const p = Number(percent) || 0;
  return roundMoney(Number(rate) * (1 - p / 100));
}

async function resolveReferrerByInput(referredBy, { buildingId = null } = {}) {
  const raw = String(referredBy || "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();

  // Referral field is apartment number — match active tenants first.
  const byAptActive = await customerStore.findCustomerByApartmentNumber(upper, {
    preferredBuildingId: buildingId,
    activeOnly: true,
  });
  if (byAptActive?.id) {
    return customerStore.getCustomerById(byAptActive.id);
  }

  // Include cancelled so callers can reject cancelled referrers explicitly.
  const byAptAny = await customerStore.findCustomerByApartmentNumber(upper, {
    preferredBuildingId: buildingId,
    activeOnly: false,
  });
  if (byAptAny?.id) {
    return customerStore.getCustomerById(byAptAny.id);
  }

  // Fallback: customer number (legacy / paste).
  const byNumber = await customerStore.findCustomerByNumber(upper);
  if (byNumber?.id) {
    return customerStore.getCustomerById(byNumber.id);
  }

  return null;
}

/**
 * Resolve whether a non-trial C2B customer should get campaign pricing + optional referral.
 */
async function resolveOnboardingCampaignContext(customer, options = {}) {
  const customerType = String(
    customer?.customerType || customer?.customer_type || ""
  ).toUpperCase();
  if (customerType !== "C2B") {
    return { eligible: false, reason: "not_c2b" };
  }

  const trialOn =
    options.trialPeriod === true ||
    customer?.trialPeriodEnabled === true ||
    customer?.trial_period_enabled === true ||
    Boolean(customer?.trialEndsAt || customer?.trial_ends_at);
  if (trialOn) {
    return { eligible: false, reason: "trial" };
  }

  let campaign = null;
  const explicitId = options.campaignId || customer?.campaignId || null;
  const explicitCode = options.campaignCode || null;
  if (explicitId || explicitCode) {
    campaign = await campaignStore.resolveActiveCampaign({
      campaignId: explicitId,
      campaignCode: explicitCode,
    });
  } else {
    const live = await campaignStore.listActiveCampaigns();
    if (live.length > 1) {
      return { eligible: false, reason: "campaign_required" };
    }
    campaign = live[0] || null;
  }
  if (!campaign) {
    return { eligible: false, reason: "no_active_campaign" };
  }

  let referrer = null;
  let referralSkippedReason = null;
  const referredBy =
    options.referredByApartmentNumber ||
    options.referredByCustomerNumber ||
    options.referredByCustomerId ||
    customer?.referredByCustomerId ||
    null;
  if (referredBy) {
    const found = await resolveReferrerByInput(referredBy, {
      buildingId:
        options.buildingId ||
        customer?.buildingId ||
        customer?.building_id ||
        null,
    });
    if (!found?.id) {
      // Invalid referrer → no referral reward; campaign first-month discount still applies.
      referralSkippedReason = "referrer_not_found";
    } else if (Number(found.id) === Number(customer.id)) {
      referralSkippedReason = "self_referral";
    } else if (String(found.status || "").toLowerCase() === "cancelled") {
      referralSkippedReason = "referrer_cancelled";
    } else {
      referrer = found;
    }
  }

  return {
    eligible: true,
    campaign,
    referrer,
    referralSkippedReason,
    packageDiscountPercent: Number(campaign.newCustomerDiscountPercent) || 0,
    appliesToDecoder: campaign.appliesToDecoder === true,
  };
}

/**
 * Persist campaign + attribution after customer create / before billing.
 */
async function attachCampaignOnOnboard(customerId, options = {}) {
  const customer = await customerStore.getCustomerById(customerId);
  if (!customer) return { attached: false, reason: "no_customer" };

  const ctx = await resolveOnboardingCampaignContext(customer, options);
  if (!ctx.eligible) {
    return { attached: false, reason: ctx.reason };
  }

  await campaignStore.setCustomerCampaignLinks(customerId, {
    campaignId: ctx.campaign.id,
    referredByCustomerId: ctx.referrer?.id || null,
  });

  let attribution = null;
  if (ctx.referrer?.id) {
    attribution = await campaignStore.createAttribution({
      campaignId: ctx.campaign.id,
      refereeCustomerId: customerId,
      referrerCustomerId: ctx.referrer.id,
    });
  }

  return {
    attached: true,
    campaign: ctx.campaign,
    referrer: ctx.referrer,
    attribution,
    packageDiscountPercent: ctx.packageDiscountPercent,
    appliesToDecoder: ctx.appliesToDecoder,
    referralSkippedReason: ctx.referralSkippedReason || null,
  };
}

async function getSignupCampaignDiscount(customerId) {
  const application = await campaignStore.getApplicationForCustomer(customerId);
  if (application?.discountPercent > 0) {
    return {
      discountPercent: application.discountPercent,
      appliesToDecoder: false,
      application,
      campaignId: application.campaignId,
    };
  }

  const customer = await customerStore.getCustomerById(customerId);
  if (!customer) return null;
  const ctx = await resolveOnboardingCampaignContext(customer);
  if (!ctx.eligible || !(ctx.packageDiscountPercent > 0)) return null;
  return {
    discountPercent: ctx.packageDiscountPercent,
    appliesToDecoder: ctx.appliesToDecoder === true,
    application: null,
    campaignId: ctx.campaign.id,
    campaign: ctx.campaign,
  };
}

/**
 * Qualify pending referral when referee signup invoice is paid, then apply/queue reward.
 */
async function onRefereeSignupPaid({
  customerId,
  customerNumber = null,
  invoiceId = null,
  source = "payment",
} = {}) {
  let customer = null;
  if (customerId) {
    customer = await customerStore.getCustomerById(customerId);
  } else if (customerNumber) {
    customer = await customerStore.findCustomerByNumber(customerNumber);
  }
  if (!customer?.id) {
    return { ok: false, reason: "customer_not_found" };
  }

  const attribution = await campaignStore.getAttributionForReferee(customer.id);
  if (!attribution) {
    return { ok: false, reason: "no_attribution" };
  }
  if (attribution.status === "rewarded") {
    return { ok: true, skipped: true, reason: "already_rewarded" };
  }
  if (attribution.status === "cancelled") {
    return { ok: false, reason: "attribution_cancelled" };
  }

  // Only treat as paid signup when invoice matches tracked signup invoice (when known).
  const trackedSignupId =
    attribution.signupInvoiceId ||
    customer.zohoSignupInvoiceId ||
    null;
  if (
    invoiceId &&
    trackedSignupId &&
    String(invoiceId) !== String(trackedSignupId)
  ) {
    return { ok: false, reason: "not_signup_invoice" };
  }

  let qualified = attribution;
  if (attribution.status === "pending_payment") {
    qualified = await campaignStore.markAttributionQualified(attribution.id, {
      signupInvoiceId: invoiceId || trackedSignupId,
    });
  }

  const existingReward = await campaignStore.getRewardByAttributionId(
    attribution.id
  );
  if (existingReward) {
    if (existingReward.status === "queued") {
      const applied = await campaignStore.getAppliedRewardForReferrer(
        attribution.referrerCustomerId
      );
      if (!applied) {
        return applyReferralReward(existingReward.id, { source });
      }
    }
    return {
      ok: true,
      skipped: true,
      reason: "reward_exists",
      reward: existingReward,
    };
  }

  const rewardPercent =
    Number(qualified.referrerRewardPercent) ||
    Number(
      (await campaignStore.getCampaignById(attribution.campaignId))
        ?.referrerRewardPercent
    ) ||
    0;
  if (!(rewardPercent > 0)) {
    return { ok: false, reason: "no_reward_percent" };
  }

  const applied = await campaignStore.getAppliedRewardForReferrer(
    attribution.referrerCustomerId
  );
  const reward = await campaignStore.createReward({
    attributionId: attribution.id,
    referrerCustomerId: attribution.referrerCustomerId,
    campaignId: attribution.campaignId,
    rewardPercent,
    status: applied ? "queued" : "queued",
  });

  if (applied) {
    try {
      await logActivity({
        eventType: "referral_reward_queued",
        title: "Referral reward queued",
        message: `${customer.customerNumber} paid — referrer reward queued behind active cycle`,
        source: "admin",
        status: "success",
        customerRef: customer.customerNumber,
        metadata: {
          rewardId: reward.id,
          referrerCustomerId: attribution.referrerCustomerId,
          source,
        },
      });
    } catch {
      /* optional */
    }
    return { ok: true, queued: true, reward };
  }

  return applyReferralReward(reward.id, { source });
}

async function findActiveRecurringForCustomer(customer) {
  const integrationSnapshot = require("../repositories/integrationSnapshot.repository");
  let contactId = null;
  try {
    contactId = await integrationSnapshot.getStoredZohoContactId(
      customer.id
    );
  } catch {
    contactId = null;
  }

  if (!contactId) {
    // Lazy resolve only when snapshot is missing (avoid circular require at load).
    try {
      const {
        ensureZohoContactForCustomer,
      } = require("../controllers/customers.controller");
      const contact = await ensureZohoContactForCustomer(customer);
      contactId = contact?.contact_id || null;
    } catch (e) {
      return { error: e.message || "zoho_contact_failed" };
    }
  }
  if (!contactId) return { error: "no_zoho_contact" };

  const list = await getRecurringInvoices_JS({
    customer_id: contactId,
    filter_by: "Status.Active",
    per_page: 50,
  });
  const customerNumber = String(customer.customerNumber || "")
    .trim()
    .toUpperCase();
  const matched = (list || []).find((row) => {
    const ref = String(row.reference_number || "").trim().toUpperCase();
    const name = String(row.recurrence_name || "").trim().toUpperCase();
    return (
      ref === customerNumber ||
      name === customerNumber ||
      name.startsWith(`${customerNumber} `) ||
      name.startsWith(`${customerNumber}-`)
    );
  });
  if (!matched?.recurring_invoice_id) {
    return { error: "no_active_recurring", contactId };
  }
  const full =
    (await getRecurringInvoice_JS(matched.recurring_invoice_id)) || matched;
  return { recurring: full, contactId };
}

function buildDiscountedLineItems(lineItems, rewardPercent) {
  const original = (lineItems || []).map((item) => ({
    line_item_id: item.line_item_id || null,
    name: item.name,
    rate: Number(item.rate),
    quantity: Number(item.quantity || 1),
    description: item.description || "",
    tax_id: item.tax_id || undefined,
  }));
  const discounted = original.map((item) => ({
    ...item,
    rate: discountRate(item.rate, rewardPercent),
    description: [
      item.description,
      `Referral reward: ${rewardPercent}% off this billing cycle`,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 2000),
  }));
  return { original, discounted };
}

async function applyReferralReward(rewardId, { source = "system" } = {}) {
  const reward = await campaignStore.getRewardById(rewardId);
  if (!reward) return { ok: false, reason: "reward_not_found" };
  if (reward.status === "applied") {
    return { ok: true, skipped: true, reason: "already_applied", reward };
  }
  if (reward.status === "restored" || reward.status === "cancelled") {
    return { ok: false, reason: `reward_${reward.status}` };
  }

  const active = await campaignStore.getAppliedRewardForReferrer(
    reward.referrerCustomerId
  );
  if (active && Number(active.id) !== Number(reward.id)) {
    // Keep queued — another cycle is already discounted.
    return { ok: true, queued: true, reward };
  }

  const referrer = await customerStore.getCustomerById(reward.referrerCustomerId);
  if (!referrer) {
    await campaignStore.markRewardFailed(reward.id, "referrer_not_found");
    return { ok: false, reason: "referrer_not_found" };
  }

  let recurringResult;
  try {
    recurringResult = await findActiveRecurringForCustomer(referrer);
  } catch (e) {
    await campaignStore.markRewardFailed(reward.id, e.message);
    return { ok: false, reason: e.message || "recurring_lookup_failed" };
  }

  if (recurringResult.error) {
    // Leave queued so maintenance can retry once recurring exists.
    await campaignStore.markRewardFailed(
      reward.id,
      recurringResult.error
    );
    // Re-queue: markRewardFailed sets failed for queued — restore to queued for retry
    await require("../config/db").query(
      `UPDATE referral_rewards SET status = 'queued', last_error = ? WHERE id = ?`,
      [String(recurringResult.error).slice(0, 500), Number(reward.id)]
    );
    return {
      ok: false,
      queued: true,
      reason: recurringResult.error,
      reward: await campaignStore.getRewardById(reward.id),
    };
  }

  const recurring = recurringResult.recurring;
  const lineItems = Array.isArray(recurring.line_items)
    ? recurring.line_items
    : [];
  if (!lineItems.length) {
    await campaignStore.markRewardFailed(reward.id, "no_line_items");
    return { ok: false, reason: "no_line_items" };
  }

  const { original, discounted } = buildDiscountedLineItems(
    lineItems,
    reward.rewardPercent
  );

  try {
    await updateRecurringInvoice_JS(String(recurring.recurring_invoice_id), {
      line_items: discounted.map((item) => {
        const payload = {
          name: item.name,
          rate: item.rate,
          quantity: item.quantity,
          description: item.description,
        };
        if (item.line_item_id) payload.line_item_id = item.line_item_id;
        if (item.tax_id) payload.tax_id = item.tax_id;
        return payload;
      }),
    });
  } catch (e) {
    await campaignStore.markRewardFailed(reward.id, e.message);
    return { ok: false, reason: e.message || "zoho_update_failed" };
  }

  const nextInvoiceDate =
    recurring.next_invoice_date ||
    recurring.last_sent_date ||
    null;
  const restoreAfter = nextInvoiceDate
    ? String(nextInvoiceDate).slice(0, 10)
    : moment.tz(DEFAULT_TZ).add(1, "month").format("YYYY-MM-DD");

  const applied = await campaignStore.markRewardApplied(reward.id, {
    zohoRecurringInvoiceId: String(recurring.recurring_invoice_id),
    originalRates: original,
    discountedRates: discounted,
    restoreAfter,
  });
  await campaignStore.markAttributionRewarded(reward.attributionId);

  let email = { ok: false, skipped: true };
  try {
    const attrRows = await require("../config/db").query(
      `SELECT referee_customer_id FROM referral_attributions WHERE id = ? LIMIT 1`,
      [Number(reward.attributionId)]
    );
    const refereeId = attrRows[0]?.referee_customer_id;
    const referee = refereeId
      ? await customerStore.getCustomerById(refereeId)
      : null;
    email = await notifyReferrerRewardEmail(referrer, applied, { referee });
    if (email?.ok) {
      await campaignStore.markRewardEmailNotified(reward.id);
    }
  } catch (e) {
    console.warn("referrer reward email failed:", e.message);
    email = { ok: false, error: e.message };
  }

  try {
    await logActivity({
      eventType: "referral_reward_applied",
      title: "Referral reward applied",
      message: `${referrer.customerNumber}: next subscription reduced by ${reward.rewardPercent}%`,
      source: "zoho",
      status: "success",
      customerRef: referrer.customerNumber,
      metadata: {
        rewardId: reward.id,
        percent: reward.rewardPercent,
        recurringInvoiceId: applied.zohoRecurringInvoiceId,
        source,
        emailOk: Boolean(email?.ok),
      },
    });
  } catch {
    /* optional */
  }

  return { ok: true, applied: true, reward: applied, email };
}

async function notifyReferrerRewardEmail(referrer, reward, { referee } = {}) {
  const { sendCustomerLifecycleEmail } = require("./customerWelcomeEmail");
  const fullPrice = Number(referrer.packagePrice || 0);
  const discounted = discountRate(fullPrice, reward.rewardPercent);
  return sendCustomerLifecycleEmail("referral_reward", referrer, {
    extraVars: {
      packagePrice: fullPrice,
      referralDiscountPercent: String(reward.rewardPercent),
      referralDiscountedPrice: discounted,
      referredCustomerNumber: referee?.customerNumber || "",
      referredCustomerName:
        [referee?.firstName, referee?.lastName].filter(Boolean).join(" ") ||
        "",
    },
  });
}

/**
 * Restore full recurring rates after the discounted cycle has billed (or is due).
 */
async function restoreReferralReward(rewardId, { childInvoiceId, childInvoiceNumber } = {}) {
  const reward = await campaignStore.getRewardById(rewardId);
  if (!reward) return { ok: false, reason: "reward_not_found" };
  if (reward.status !== "applied") {
    return { ok: false, reason: `reward_${reward.status}` };
  }
  if (!reward.zohoRecurringInvoiceId || !reward.originalRates?.length) {
    return { ok: false, reason: "missing_restore_snapshot" };
  }

  try {
    await updateRecurringInvoice_JS(reward.zohoRecurringInvoiceId, {
      line_items: reward.originalRates.map((item) => {
        const payload = {
          name: item.name,
          rate: Number(item.rate),
          quantity: Number(item.quantity || 1),
          description: String(item.description || "").replace(
            /\n?Referral reward:.*$/m,
            ""
          ),
        };
        if (item.line_item_id) payload.line_item_id = item.line_item_id;
        if (item.tax_id) payload.tax_id = item.tax_id;
        return payload;
      }),
    });
  } catch (e) {
    await campaignStore.markRewardFailed(reward.id, e.message);
    return { ok: false, reason: e.message || "zoho_restore_failed" };
  }

  const restored = await campaignStore.markRewardRestored(reward.id, {
    childInvoiceId,
    childInvoiceNumber,
  });

  const referrer = await customerStore.getCustomerById(reward.referrerCustomerId);
  try {
    await logActivity({
      eventType: "referral_reward_restored",
      title: "Referral reward restored",
      message: `${referrer?.customerNumber || reward.referrerCustomerId}: recurring returned to full price`,
      source: "zoho",
      status: "success",
      customerRef: referrer?.customerNumber || null,
      metadata: { rewardId: reward.id },
    });
  } catch {
    /* optional */
  }

  // Drain queue: apply next queued reward for this referrer.
  const next = await campaignStore.getNextQueuedReward(reward.referrerCustomerId);
  let nextResult = null;
  if (next) {
    nextResult = await applyReferralReward(next.id, { source: "queue_drain" });
  }

  return { ok: true, restored: true, reward: restored, next: nextResult };
}

/**
 * Maintenance: restore applied rewards when a child invoice exists after apply,
 * or when restore_after date has passed.
 */
async function processReferralRewardMaintenance({ limit = 50 } = {}) {
  const due = await campaignStore.listAppliedRewardsDueForRestore(limit);
  const results = [];

  for (const reward of due) {
    try {
      let childInvoiceId = null;
      let childInvoiceNumber = null;
      let shouldRestore = false;

      if (reward.zohoRecurringInvoiceId) {
        const referrer = await customerStore.getCustomerById(
          reward.referrerCustomerId
        );
        if (referrer) {
          const found = await findActiveRecurringForCustomer(referrer);
          const contactId = found.contactId;
          if (contactId) {
            const invoices = await getInvoices_JS({
              customer_id: contactId,
              per_page: 25,
              page: 1,
              sort_column: "created_time",
              sort_order: "D",
            });
            const appliedAtMs = reward.appliedAt
              ? new Date(reward.appliedAt).getTime()
              : 0;
            const child = (invoices || []).find((inv) => {
              const status = String(inv.status || "").toLowerCase();
              if (status === "void" || status === "draft") return false;
              const created = inv.created_time || inv.date;
              const createdMs = created ? new Date(created).getTime() : 0;
              if (!(createdMs > appliedAtMs)) return false;
              // Prefer invoices whose total matches discounted package (approx).
              return true;
            });
            if (child?.invoice_id) {
              childInvoiceId = String(child.invoice_id);
              childInvoiceNumber = child.invoice_number || null;
              shouldRestore = true;
            }
          }
        }
      }

      if (
        !shouldRestore &&
        reward.restoreAfter &&
        String(reward.restoreAfter) <= moment.tz(DEFAULT_TZ).format("YYYY-MM-DD")
      ) {
        // Due date passed — restore even if we cannot find the child invoice yet.
        shouldRestore = true;
      }

      if (shouldRestore) {
        results.push(
          await restoreReferralReward(reward.id, {
            childInvoiceId,
            childInvoiceNumber,
          })
        );
      } else {
        results.push({ ok: true, skipped: true, rewardId: reward.id });
      }
    } catch (e) {
      results.push({
        ok: false,
        rewardId: reward.id,
        error: e.message || "maintenance_failed",
      });
    }
  }

  // Retry queued rewards that have no active applied sibling.
  const queuedRetries = await require("../config/db").query(
    `SELECT r.id, r.referrer_customer_id
     FROM referral_rewards r
     WHERE r.status = 'queued'
       AND NOT EXISTS (
         SELECT 1 FROM referral_rewards a
         WHERE a.referrer_customer_id = r.referrer_customer_id
           AND a.status = 'applied'
       )
     ORDER BY r.queue_order ASC, r.id ASC
     LIMIT ?`,
    [Number(limit) || 50]
  );
  const seenReferrers = new Set();
  for (const row of queuedRetries) {
    const rid = Number(row.referrer_customer_id);
    if (seenReferrers.has(rid)) continue;
    seenReferrers.add(rid);
    results.push(await applyReferralReward(row.id, { source: "maintenance" }));
  }

  return { ok: true, processed: results.length, results };
}

/**
 * If referrer has an applied reward, keep recurring line rates discounted
 * when other flows call ensureRecurringSubscription.
 */
async function overlayReferralDiscountOnLineItems(customerId, lineItems) {
  const applied = await campaignStore.getAppliedRewardForReferrer(customerId);
  if (!applied || !(applied.rewardPercent > 0) || !lineItems?.length) {
    return lineItems;
  }
  return lineItems.map((item) => ({
    ...item,
    rate: discountRate(item.rate, applied.rewardPercent),
    description: [
      item.description,
      `Referral reward: ${applied.rewardPercent}% off this billing cycle`,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 2000),
  }));
}

module.exports = {
  resolveOnboardingCampaignContext,
  attachCampaignOnOnboard,
  getSignupCampaignDiscount,
  onRefereeSignupPaid,
  applyReferralReward,
  restoreReferralReward,
  processReferralRewardMaintenance,
  overlayReferralDiscountOnLineItems,
  discountRate,
};
