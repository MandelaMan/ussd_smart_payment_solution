function normalizeFrequency(frequency) {
  if (!frequency || frequency === "custom") return "monthly";
  return frequency;
}

/**
 * Compare packages by price at the selected billing frequency.
 * Upgrade = strictly higher price; downgrade = strictly lower price.
 */
function classifyPackageChangeByPrice(baselinePrice, newPrice) {
  const baseline = Math.round(Number(baselinePrice) || 0);
  const next = Math.round(Number(newPrice) || 0);
  return {
    baselinePrice: baseline,
    newPrice: next,
    isUpgrade: next > baseline,
    isDowngrade: next < baseline,
    isSamePrice: next === baseline,
  };
}

/**
 * Resolve the customer's current-plan price at the target billing frequency.
 * Uses the same-plan twin when frequency changes; otherwise package_price.
 */
async function resolveBaselinePriceAtFrequency(
  store,
  current,
  paymentFrequency,
  customPeriodDays
) {
  const currentFreq = normalizeFrequency(current.payment_frequency);
  const targetFreq = normalizeFrequency(paymentFrequency);
  const sameCustomPeriod =
    paymentFrequency === "custom" &&
    current.payment_frequency === "custom" &&
    Number(customPeriodDays) === Number(current.custom_period_days || 0);

  if (
    (paymentFrequency === current.payment_frequency &&
      paymentFrequency !== "custom") ||
    sameCustomPeriod
  ) {
    return Math.round(Number(current.package_price) || 0);
  }

  if (typeof store.findProductForBillingFrequency === "function") {
    try {
      const twin = await store.findProductForBillingFrequency(
        current,
        paymentFrequency
      );
      return Math.round(
        Number(
          store.resolvePackagePrice(twin, paymentFrequency, customPeriodDays)
        ) || 0
      );
    } catch {
      /* fall through */
    }
  }

  if (targetFreq === currentFreq && paymentFrequency === "custom") {
    const days = Number(customPeriodDays);
    const currentDays = Number(current.custom_period_days) || 30;
    if (days >= 1 && currentDays >= 1) {
      return Math.round(
        (Number(current.package_price) * days) / currentDays
      );
    }
  }

  return Math.round(Number(current.package_price) || 0);
}

/** @deprecated Prefer classifyPackageChangeByPrice after resolving prices. */
function classifyPackageChange(current, newProduct, targetFrequency) {
  const currentFreq = normalizeFrequency(current.payment_frequency);
  const targetFreq = normalizeFrequency(
    targetFrequency != null ? targetFrequency : current.payment_frequency
  );
  const frequencyChanged = targetFreq !== currentFreq;
  const baseline = Math.round(Number(current.package_price) || 0);
  const next = Math.round(Number(newProduct.price) || 0);
  const byPrice = classifyPackageChangeByPrice(baseline, next);
  return {
    frequencyChanged,
    ...byPrice,
    isUpgrade: byPrice.isUpgrade,
    isDowngrade: byPrice.isDowngrade,
  };
}

module.exports = {
  normalizeFrequency,
  classifyPackageChange,
  classifyPackageChangeByPrice,
  resolveBaselinePriceAtFrequency,
};
