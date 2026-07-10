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

/**
 * Compute upgrade top-up from current/new package price, billing period, and TISP due date.
 */
function calculateUpgradeQuote({
  currentPrice,
  newPrice,
  paymentFrequency,
  customPeriodDays,
  subscriptionStatus,
  dueDate,
  customerType,
  now = new Date(),
}) {
  const current = Math.round(Number(currentPrice) || 0);
  const next = Math.round(Number(newPrice) || 0);
  const priceDifference = next - current;
  const active = isActiveSubscription(subscriptionStatus);
  const periodDays = periodDaysForFrequency(paymentFrequency, customPeriodDays);
  const due = parseDueDate(dueDate);

  let topUpAmount = 0;
  let explanation = "";
  let daysUntilDue = null;
  let daysRemainingInPeriod = null;

  if (priceDifference <= 0) {
    explanation = "No additional payment is required for this upgrade.";
  } else if (!active) {
    topUpAmount = next;
    explanation =
      "Subscription is not active — the customer pays the full new package price.";
  } else if (due && due > now) {
    daysUntilDue = Math.ceil((due.getTime() - now.getTime()) / MS_PER_DAY);
    daysRemainingInPeriod = Math.min(Math.max(daysUntilDue, 0), periodDays);
    topUpAmount = Math.round(priceDifference * (daysRemainingInPeriod / periodDays));
    explanation = `Prorated upgrade for ${daysRemainingInPeriod} of ${periodDays} days remaining until the subscription is due (${due.toISOString().slice(0, 10)}).`;
  } else if (due && due <= now) {
    daysUntilDue = Math.ceil((due.getTime() - now.getTime()) / MS_PER_DAY);
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
    dueDate: due ? due.toISOString().slice(0, 10) : null,
    subscriptionStatus: subscriptionStatus || null,
    isActive: active,
    periodDays,
    daysUntilDue,
    daysRemainingInPeriod,
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
  periodDaysForFrequency,
  estimateDueDateFromLastPayment,
};
