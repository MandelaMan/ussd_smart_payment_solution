function num(value) {
  return Number(value || 0);
}

function str(value) {
  return String(value == null ? "" : value).trim();
}

function emptyBillingSync() {
  return {
    customers: 0,
    active: 0,
    zohoUpdated: 0,
    zohoSkipped: 0,
    zohoFailed: 0,
    tispFailed: 0,
    agencyUpdated: 0,
    errors: [],
  };
}

function isProductBillingRelevantChange(before, after) {
  if (!before || !after) return true;
  return (
    num(before.price) !== num(after.price) ||
    num(before.monthlyPrice ?? before.monthly_price) !==
      num(after.monthlyPrice ?? after.monthly_price) ||
    num(before.mbps) !== num(after.mbps) ||
    num(before.extraBandwidth ?? before.extra_bandwidth) !==
      num(after.extraBandwidth ?? after.extra_bandwidth) ||
    str(before.name) !== str(after.name) ||
    str(before.paymentFrequency ?? before.payment_frequency) !==
      str(after.paymentFrequency ?? after.payment_frequency) ||
    num(before.planVariantId ?? before.plan_variant_id) !==
      num(after.planVariantId ?? after.plan_variant_id) ||
    num(before.hasDstv ?? before.has_dstv) !== num(after.hasDstv ?? after.has_dstv)
  );
}

function productFrequencyChanged(before, after) {
  if (!before || !after) return false;
  return (
    str(before.paymentFrequency ?? before.payment_frequency) !==
    str(after.paymentFrequency ?? after.payment_frequency)
  );
}

module.exports = {
  emptyBillingSync,
  isProductBillingRelevantChange,
  productFrequencyChanged,
};
