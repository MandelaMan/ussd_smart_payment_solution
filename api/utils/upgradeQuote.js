const MS_PER_DAY = 24 * 60 * 60 * 1000;

function periodDaysForFrequency(paymentFrequency, customPeriodDays) {
  switch (paymentFrequency) {
    case "quarterly":
      return 90;
    case "yearly":
      return 365;
    case "custom": {
      const days = Number(customPeriodDays);
      return days > 0 ? days : 30;
    }
    case "monthly":
    default:
      return 30;
  }
}

function normalizeFrequency(frequency) {
  if (!frequency || frequency === "custom") return "monthly";
  return String(frequency);
}

function parseDueDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isActiveSubscription(status) {
  return String(status || "")
    .trim()
    .toLowerCase()
    .includes("active");
}

function recommendPaymentMethod({ customerType, daysUntilDue, topUpAmount }) {
  if (topUpAmount <= 0) return "none";
  if (customerType === "B2B") return "invoice";
  if (daysUntilDue != null && daysUntilDue > 14) return "invoice";
  return "stk";
}

function frequenciesDiffer(
  currentFrequency,
  currentCustomPeriodDays,
  newFrequency,
  newCustomPeriodDays
) {
  const currentFreq = String(currentFrequency || "monthly");
  const newFreq = String(newFrequency || "monthly");
  if (currentFreq !== newFreq) return true;
  if (currentFreq === "custom" || newFreq === "custom") {
    return Number(currentCustomPeriodDays || 0) !== Number(newCustomPeriodDays || 0);
  }
  return false;
}

/**
 * Compute upgrade top-up from current/new package price, billing period, and due date.
 *
 * Same billing frequency: prorated price difference for days left in the period.
 * Frequency change (e.g. monthly → yearly): full new package price minus unused
 * credit on the current period (days left × current period price / period length).
 */
function calculateUpgradeQuote({
  currentPrice,
  newPrice,
  paymentFrequency,
  customPeriodDays,
  currentPaymentFrequency,
  currentCustomPeriodDays,
  subscriptionStatus,
  dueDate,
  customerType,
  now = new Date(),
}) {
  const current = Math.round(Number(currentPrice) || 0);
  const next = Math.round(Number(newPrice) || 0);
  const active = isActiveSubscription(subscriptionStatus);

  const currentFreq = currentPaymentFrequency || paymentFrequency || "monthly";
  const currentPeriodDays = periodDaysForFrequency(
    currentFreq,
    currentCustomPeriodDays != null ? currentCustomPeriodDays : customPeriodDays
  );
  const newPeriodDays = periodDaysForFrequency(paymentFrequency, customPeriodDays);
  const frequencyChanged = frequenciesDiffer(
    currentFreq,
    currentCustomPeriodDays,
    paymentFrequency,
    customPeriodDays
  );

  const due = parseDueDate(dueDate);
  let topUpAmount = 0;
  let explanation = "";
  let daysUntilDue = null;
  let daysRemainingInPeriod = null;
  let remainingCredit = 0;
  const priceDifference = next - current;

  if (due) {
    daysUntilDue = Math.ceil((due.getTime() - now.getTime()) / MS_PER_DAY);
    if (due > now) {
      daysRemainingInPeriod = Math.min(
        Math.max(daysUntilDue, 0),
        currentPeriodDays
      );
    } else {
      daysRemainingInPeriod = 0;
    }
  }

  if (next <= 0) {
    explanation = "No additional payment is required for this upgrade.";
  } else if (!active) {
    topUpAmount = next;
    explanation =
      "Subscription is not active — the customer pays the full new package price.";
  } else if (frequencyChanged) {
    if (daysRemainingInPeriod != null && daysRemainingInPeriod > 0) {
      remainingCredit = Math.round(
        (current * daysRemainingInPeriod) / currentPeriodDays
      );
      topUpAmount = Math.max(0, next - remainingCredit);
      explanation = `Yearly/new-period upgrade: ${daysRemainingInPeriod} of ${currentPeriodDays} days left on the current ${current.toLocaleString("en-KE")} period credited (${remainingCredit.toLocaleString("en-KE")}) against ${next.toLocaleString("en-KE")}.`;
    } else if (due && due <= now) {
      topUpAmount = next;
      explanation =
        "Subscription is past due — no unused credit; full new package price applies.";
    } else {
      topUpAmount = next;
      explanation =
        "Due date unavailable — full new package price applies (no unused-period credit).";
    }
  } else if (priceDifference <= 0) {
    explanation = "No additional payment is required for this upgrade.";
  } else if (due && due > now && daysRemainingInPeriod != null) {
    topUpAmount = Math.round(
      (priceDifference * daysRemainingInPeriod) / currentPeriodDays
    );
    explanation = `Prorated upgrade for ${daysRemainingInPeriod} of ${currentPeriodDays} days remaining until the subscription is due (${due.toISOString().slice(0, 10)}).`;
  } else if (due && due <= now) {
    topUpAmount = priceDifference;
    explanation =
      "Subscription is past due — the full upgrade difference applies for the current billing period.";
  } else {
    topUpAmount = priceDifference;
    explanation =
      "Due date unavailable — the full upgrade difference applies for the current billing period.";
  }

  topUpAmount = Math.max(0, topUpAmount);

  const recommendedPaymentMethod = recommendPaymentMethod({
    customerType,
    daysUntilDue,
    topUpAmount,
  });

  return {
    topUpAmount,
    currentPrice: current,
    newPrice: next,
    priceDifference,
    remainingCredit,
    creditAmount: 0,
    dueDate: due ? due.toISOString().slice(0, 10) : null,
    subscriptionStatus: subscriptionStatus || null,
    isActive: active,
    periodDays: frequencyChanged ? newPeriodDays : currentPeriodDays,
    currentPeriodDays,
    daysUntilDue,
    daysRemainingInPeriod,
    frequencyChanged,
    recommendedPaymentMethod,
    explanation,
    paymentRequired: topUpAmount > 0,
  };
}

/**
 * Compute downgrade settlement from current/new package price and days left.
 *
 * Same billing frequency: prorated credit for the price drop over days remaining.
 * Frequency change (e.g. yearly → monthly): unused credit on the current period
 * is applied against the new package price (leftover credit or rare top-up).
 */
function calculateDowngradeQuote({
  currentPrice,
  newPrice,
  paymentFrequency,
  customPeriodDays,
  currentPaymentFrequency,
  currentCustomPeriodDays,
  subscriptionStatus,
  dueDate,
  customerType,
  now = new Date(),
}) {
  const current = Math.round(Number(currentPrice) || 0);
  const next = Math.round(Number(newPrice) || 0);
  const active = isActiveSubscription(subscriptionStatus);

  const currentFreq = currentPaymentFrequency || paymentFrequency || "monthly";
  const currentPeriodDays = periodDaysForFrequency(
    currentFreq,
    currentCustomPeriodDays != null ? currentCustomPeriodDays : customPeriodDays
  );
  const newPeriodDays = periodDaysForFrequency(paymentFrequency, customPeriodDays);
  const frequencyChanged = frequenciesDiffer(
    currentFreq,
    currentCustomPeriodDays,
    paymentFrequency,
    customPeriodDays
  );

  const due = parseDueDate(dueDate);
  let topUpAmount = 0;
  let creditAmount = 0;
  let remainingCredit = 0;
  let explanation = "";
  let daysUntilDue = null;
  let daysRemainingInPeriod = null;
  const priceDifference = next - current;

  if (due) {
    daysUntilDue = Math.ceil((due.getTime() - now.getTime()) / MS_PER_DAY);
    if (due > now) {
      daysRemainingInPeriod = Math.min(
        Math.max(daysUntilDue, 0),
        currentPeriodDays
      );
    } else {
      daysRemainingInPeriod = 0;
    }
  }

  if (!active) {
    explanation =
      "Subscription is not active — package switches with no unused-period credit.";
  } else if (frequencyChanged) {
    if (daysRemainingInPeriod != null && daysRemainingInPeriod > 0) {
      remainingCredit = Math.round(
        (current * daysRemainingInPeriod) / currentPeriodDays
      );
      const net = next - remainingCredit;
      if (net > 0) {
        topUpAmount = net;
        explanation = `Frequency change downgrade: ${daysRemainingInPeriod} of ${currentPeriodDays} days left credited (${remainingCredit.toLocaleString("en-KE")}) against new ${next.toLocaleString("en-KE")} — top-up required.`;
      } else {
        creditAmount = Math.abs(net);
        explanation = `Frequency change downgrade: ${daysRemainingInPeriod} of ${currentPeriodDays} days left on the current ${current.toLocaleString("en-KE")} period credited (${remainingCredit.toLocaleString("en-KE")}) against ${next.toLocaleString("en-KE")}.`;
      }
    } else if (due && due <= now) {
      explanation =
        "Subscription is past due — no unused credit; package switches to the lower plan.";
    } else {
      explanation =
        "Due date unavailable — no unused-period credit applied; package switches to the lower plan.";
    }
  } else if (priceDifference >= 0) {
    explanation = "Selected package is not cheaper than the current plan.";
  } else if (due && due > now && daysRemainingInPeriod != null) {
    remainingCredit = Math.round(
      (current * daysRemainingInPeriod) / currentPeriodDays
    );
    creditAmount = Math.round(
      ((current - next) * daysRemainingInPeriod) / currentPeriodDays
    );
    explanation = `Prorated downgrade credit for ${daysRemainingInPeriod} of ${currentPeriodDays} days remaining until the subscription is due (${due.toISOString().slice(0, 10)}).`;
  } else if (due && due <= now) {
    explanation =
      "Subscription is past due — no prorated credit; package switches to the lower plan.";
  } else {
    explanation =
      "Due date unavailable — no prorated credit; package switches to the lower plan.";
  }

  topUpAmount = Math.max(0, topUpAmount);
  creditAmount = Math.max(0, creditAmount);

  const recommendedPaymentMethod = recommendPaymentMethod({
    customerType,
    daysUntilDue,
    topUpAmount,
  });

  return {
    topUpAmount,
    creditAmount,
    currentPrice: current,
    newPrice: next,
    priceDifference,
    remainingCredit,
    dueDate: due ? due.toISOString().slice(0, 10) : null,
    subscriptionStatus: subscriptionStatus || null,
    isActive: active,
    periodDays: frequencyChanged ? newPeriodDays : currentPeriodDays,
    currentPeriodDays,
    daysUntilDue,
    daysRemainingInPeriod,
    frequencyChanged,
    recommendedPaymentMethod,
    explanation,
    paymentRequired: topUpAmount > 0,
  };
}

function estimateDueDateFromLastPayment(
  lastPaymentDate,
  paymentFrequency,
  customPeriodDays
) {
  const start = parseDueDate(lastPaymentDate);
  if (!start) return null;
  const periodDays = periodDaysForFrequency(paymentFrequency, customPeriodDays);
  const due = new Date(start.getTime() + periodDays * MS_PER_DAY);
  return due.toISOString().slice(0, 10);
}

module.exports = {
  calculateUpgradeQuote,
  calculateDowngradeQuote,
  estimateDueDateFromLastPayment,
  recommendPaymentMethod,
};
