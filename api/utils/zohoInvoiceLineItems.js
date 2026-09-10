const {
  buildPackageLabel,
  buildSubscriptionInvoiceDescription,
  buildRecurringSubscriptionInvoiceDescription,
} = require("./billingPeriod");
const {
  isB2BCustomer,
  buildManagedHouseLineItemName,
  buildManagedHouseLineItemDescription,
  buildManagedHouseRecurringLineItemDescription,
} = require("./b2bBilling");
const { buildingUsesDecoder } = require("./dstvSetup");

const ZOHO_VAT_TAX_ID = process.env.ZOHO_VAT_TAX_ID || null;
const DSTV_ONE_TIME_FEE = Number(process.env.ZOHO_DSTV_ONE_TIME_FEE || 2900);
const EXTRA_TV_UNIT_FEE = Number(process.env.ZOHO_EXTRA_TV_FEE || 500) || 500;
const MAX_TV_COUNT = 10;
const EXTRA_TV_LINE_NAME_RE = /^extra tvs?\b/i;

function withTax(lineItem) {
  if (ZOHO_VAT_TAX_ID) {
    lineItem.tax_id = ZOHO_VAT_TAX_ID;
  }
  return lineItem;
}

function customerHasDstv(customer) {
  return Boolean(
    customer?.hasDstv ||
      customer?.productHasDstv ||
      customer?.product_has_dstv ||
      customer?.has_dstv
  );
}

function resolveDstvOneTimeFee(customer) {
  const fromCustomer = Number(customer?.decoderFeeAmount);
  if (fromCustomer > 0) return fromCustomer;
  const fromSnake = Number(customer?.decoder_fee_amount);
  if (fromSnake > 0) return fromSnake;
  return DSTV_ONE_TIME_FEE;
}

function shouldIncludeDstvOneTimeFee(customer) {
  if (!buildingUsesDecoder(customer)) return false;
  return (
    customerHasDstv(customer) ||
    Boolean(customer?.decoderFeeRequired) ||
    Boolean(customer?.decoder_fee_required)
  );
}

/** TV packages: anything except Internet Only. Fallback to DSTV when catalog is missing. */
function packageIncludesTvService(customer) {
  const code = String(
    customer?.categoryCode || customer?.category_code || customer?.code || ""
  )
    .trim()
    .toLowerCase();
  if (code === "internet_only") return false;
  if (code) return true;
  return customerHasDstv(customer);
}

function extraTvUnitFee() {
  const n = Number(process.env.ZOHO_EXTRA_TV_FEE || EXTRA_TV_UNIT_FEE);
  return n > 0 ? n : 500;
}

function normalizeTvCount(value, includesTv = true) {
  if (!includesTv) return 1;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MAX_TV_COUNT, Math.floor(n));
}

function resolveTvCountForProduct(product, requested) {
  return normalizeTvCount(
    requested,
    packageIncludesTvService({
      categoryCode: product?.category_code || product?.categoryCode,
      hasDstv: product?.has_dstv || product?.hasDstv,
      product_has_dstv: product?.has_dstv || product?.hasDstv,
    })
  );
}

function extraTvCount(customer) {
  if (!packageIncludesTvService(customer)) return 0;
  const tvs = normalizeTvCount(
    customer?.tvCount ?? customer?.tv_count,
    true
  );
  return Math.max(0, tvs - 1);
}

function extraTvAmount(customer) {
  return extraTvCount(customer) * extraTvUnitFee();
}

function isExtraTvLineItem(item) {
  return EXTRA_TV_LINE_NAME_RE.test(String(item?.name || "").trim());
}

function extraTvLineMatchKey(item) {
  const name = String(item?.name || "").trim().toLowerCase();
  const house = name.match(/[—–-]\s*(.+)$/);
  if (house) return `house:${house[1].trim()}`;
  return "c2b";
}

function extraTvLineName(quantity, customerNumber = "") {
  const qty = Number(quantity) || 1;
  const base = qty === 1 ? "Extra TV" : "Extra TVs";
  const number = String(customerNumber || "").trim();
  return number ? `${base} — ${number}` : base;
}

/**
 * Recurring Extra TV line (KES 500 each above the first TV), or null.
 * options.name — override (e.g. include customer number on agency invoices)
 */
function buildExtraTvLineItem(customer, options = {}) {
  const qty = extraTvCount(customer);
  if (!(qty > 0)) return null;
  const unit = extraTvUnitFee();
  const customerNumber = String(
    customer?.customerNumber || customer?.customer_number || ""
  ).trim();
  const name = options.name || extraTvLineName(qty, options.includeCustomerNumber ? customerNumber : "");
  return withTax({
    name,
    rate: unit,
    quantity: qty,
    description:
      qty === 1
        ? `Additional TV point (KES ${Math.round(unit)} per TV)`
        : `${qty} additional TV points (KES ${Math.round(unit)} each)`,
  });
}

/**
 * Merge next line items onto an existing Zoho recurring profile.
 * Extra TV is matched by name so the package line is never overwritten.
 * Leftover Extra TV (and any unused) lines are marked for deletion.
 */
function mergeRecurringLineItems(existingItems, nextItems) {
  const existing = Array.isArray(existingItems) ? existingItems : [];
  const next = Array.isArray(nextItems) ? nextItems : [];
  const usedIds = new Set();

  function takeExisting(predicate) {
    const found = existing.find(
      (item) =>
        item?.line_item_id &&
        !usedIds.has(String(item.line_item_id)) &&
        predicate(item)
    );
    if (found?.line_item_id) usedIds.add(String(found.line_item_id));
    return found;
  }

  const merged = next.map((item) => {
    const prev = isExtraTvLineItem(item)
      ? takeExisting(
          (e) =>
            isExtraTvLineItem(e) &&
            extraTvLineMatchKey(e) === extraTvLineMatchKey(item)
        )
      : takeExisting((e) => !isExtraTvLineItem(e));
    if (prev?.line_item_id) {
      return { ...item, line_item_id: prev.line_item_id };
    }
    return item;
  });

  for (const leftover of existing) {
    if (leftover?.line_item_id && !usedIds.has(String(leftover.line_item_id))) {
      merged.push({ line_item_id: leftover.line_item_id, delete: true });
    }
  }
  return merged;
}

/**
 * Resolve which signup line items an advance payment covers.
 * Every package asks what the payment covers (Internet/package).
 * DSTV packages also allow a separate decoder allocation.
 */
function resolveAdvancePaymentCoverage(customer, options = {}) {
  const hasDstv = shouldIncludeDstvOneTimeFee(customer);
  const paymentAlreadyMade = options.paymentAlreadyMade === true;
  const skipDecoderFee =
    options.skipDecoderFee === true || options.includeOneTimeDstvFee === false;

  if (!paymentAlreadyMade) {
    return {
      includePackage: true,
      includeDecoder: hasDstv && !skipDecoderFee,
      hasDstv,
    };
  }

  // Explicit flags from admin (preferred).
  if (
    options.paymentCoversInternet != null ||
    options.paymentCoversDecoder != null
  ) {
    return {
      includePackage: options.paymentCoversInternet === true,
      includeDecoder: hasDstv && options.paymentCoversDecoder === true,
      hasDstv,
    };
  }

  // Legacy callers with no coverage flags → full first invoice.
  return {
    includePackage: true,
    includeDecoder: hasDstv,
    hasDstv,
  };
}

function normalizePackageDiscountPercent(options = {}) {
  const n = Number(options.packageDiscountPercent);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, n);
}

function discountedPackageAmount(packagePrice, discountPercent) {
  const price = Number(packagePrice) || 0;
  const pct = normalizePackageDiscountPercent({
    packageDiscountPercent: discountPercent,
  });
  if (!(pct > 0)) return price;
  return Math.round(price * (1 - pct / 100) * 100) / 100;
}

/** Expected signup invoice total for the selected coverage (always from package fields). */
function expectedSignupInvoiceTotal(customer, options = {}) {
  const coverage =
    options.includePackage != null || options.includeOneTimeDstvFee != null
      ? {
          includePackage: options.includePackage !== false,
          includeDecoder: options.includeOneTimeDstvFee === true,
          hasDstv: shouldIncludeDstvOneTimeFee(customer),
        }
      : resolveAdvancePaymentCoverage(customer, options);

  const packageDiscountPercent = normalizePackageDiscountPercent(options);
  // Decoder is never campaign-discounted unless explicitly opted in.
  const discountDecoder =
    options.appliesToDecoder === true && packageDiscountPercent > 0;

  let total = 0;
  if (coverage.includePackage) {
    const packagePrice = Number(
      customer?.packagePrice || customer?.package_price || 0
    );
    total += discountedPackageAmount(packagePrice, packageDiscountPercent);
    total += extraTvAmount(customer);
  }
  if (coverage.includeDecoder && shouldIncludeDstvOneTimeFee(customer)) {
    const fee = resolveDstvOneTimeFee(customer);
    total += discountDecoder
      ? discountedPackageAmount(fee, packageDiscountPercent)
      : fee;
  }
  return total;
}

/**
 * Human-readable Zoho invoice notes for advance-payment reconciliation.
 * Always quotes package / decoder amounts from the customer package.
 */
function buildAdvancePaymentInvoiceNotes({
  customer,
  coverage,
  paymentReference,
  paymentMethod,
  paymentAmount,
  expectedAmount,
}) {
  const lines = [];
  const covers = [];
  if (coverage?.includePackage) covers.push("Internet / package");
  if (coverage?.includeDecoder) covers.push("DSTV decoder");
  lines.push(
    `Advance payment covers: ${covers.length ? covers.join(" + ") : "none"}`
  );

  const method = String(paymentMethod || "").trim();
  const ref = String(paymentReference || "").trim();
  if (method) lines.push(`Payment method: ${method}`);
  if (ref) lines.push(`Payment reference: ${ref}`);

  const packagePrice = Number(
    customer?.packagePrice || customer?.package_price || 0
  );
  const decoderFee = resolveDstvOneTimeFee(customer);
  const extraTv = extraTvAmount(customer);
  if (coverage?.includePackage) {
    lines.push(`Package (from plan): KES ${Math.round(packagePrice)}`);
    if (extraTv > 0) {
      lines.push(
        `Extra TV (${extraTvCount(customer)}): KES ${Math.round(extraTv)}`
      );
    }
  }
  if (coverage?.includeDecoder) {
    lines.push(`Decoder (from plan): KES ${Math.round(decoderFee)}`);
  }
  if (
    coverage?.hasDstv &&
    coverage?.includePackage &&
    !coverage?.includeDecoder
  ) {
    lines.push(
      `DSTV decoder not included in this payment — still outstanding (KES ${Math.round(decoderFee)})`
    );
  }
  if (
    coverage?.hasDstv &&
    !coverage?.includePackage &&
    coverage?.includeDecoder
  ) {
    lines.push(
      `Internet/package not included in this payment — still outstanding (KES ${Math.round(packagePrice + extraTv)})`
    );
  }
  if (!coverage?.includePackage && !coverage?.includeDecoder) {
    lines.push("No package components selected for this payment");
  }

  const expected = Math.round(Number(expectedAmount) || 0);
  lines.push(`Expected invoice total: KES ${expected}`);

  if (paymentAmount != null && Number.isFinite(Number(paymentAmount))) {
    const paid = Math.round(Number(paymentAmount));
    lines.push(`Payment amount: KES ${paid}`);
    const diff = paid - expected;
    if (Math.abs(diff) <= 1) {
      lines.push("Reconciliation: MATCH — payment equals expected package total");
    } else if (diff < 0) {
      lines.push(
        `Reconciliation: MISMATCH — payment short by KES ${Math.abs(diff)}`
      );
    } else {
      lines.push(`Reconciliation: MISMATCH — payment over by KES ${diff}`);
    }
  } else {
    lines.push("Reconciliation: payment amount not verified in Zoho");
  }

  return lines.join("\n");
}

/**
 * One-time decoder / DSTV charge line item, or null when not applicable.
 * options.name — override line name (e.g. include customer number on agency invoices)
 */
function buildDstvDecoderFeeLineItem(customer, options = {}) {
  if (!shouldIncludeDstvOneTimeFee(customer)) return null;
  const fee = resolveDstvOneTimeFee(customer);
  if (!(fee > 0)) return null;

  const serial = String(
    customer?.dstvDecoderSerial || customer?.dstv_decoder_serial || ""
  ).trim();
  const customerNumber = String(
    customer?.customerNumber || customer?.customer_number || ""
  ).trim();
  const name =
    options.name ||
    (customerNumber ? `Decoder charge — ${customerNumber}` : "Decoder charge");

  return withTax({
    name,
    rate: fee,
    quantity: 1,
    description: serial
      ? `One-time DSTV decoder charge (serial: ${serial})`
      : "One-time DSTV decoder charge",
  });
}

/**
 * Build Zoho invoice line items for a subscription period.
 * Decoder charge is added when includeOneTimeDstvFee is true (signup / first invoice).
 * Recurring profiles must pass includeOneTimeDstvFee: false (default).
 * options.includePackage — false to bill decoder only (advance payment allocation).
 */
function buildSubscriptionLineItems(customer, period, options = {}) {
  const items = [];
  const includePackage = options.includePackage !== false;
  const packagePrice = Number(customer.packagePrice || 0);
  const b2b = isB2BCustomer(customer);
  const lineName = b2b
    ? buildManagedHouseLineItemName(customer)
    : buildPackageLabel(customer);
  // Recurring profiles: Zoho placeholders so each generated invoice gets fresh dates.
  // One-off invoices: concrete start/stop labels from `period`.
  const periodDescription = options.dynamicBillingCycleDates
    ? b2b
      ? buildManagedHouseRecurringLineItemDescription(customer)
      : buildRecurringSubscriptionInvoiceDescription(
          customer.paymentFrequency || customer.payment_frequency,
          customer.customPeriodDays ?? customer.custom_period_days
        )
    : b2b
      ? buildManagedHouseLineItemDescription(customer, period)
      : buildSubscriptionInvoiceDescription(customer, period);

  const packageDiscountPercent = normalizePackageDiscountPercent(options);

  if (includePackage) {
    const packageLine = withTax({
      name: lineName,
      rate: packagePrice,
      quantity: 1,
      description: periodDescription,
    });
    // Line-level % discount so Zoho invoice shows 50% off the package only
    // (decoder stays full price on a separate line).
    if (packageDiscountPercent > 0) {
      packageLine.discount = packageDiscountPercent;
      packageLine.description = [
        periodDescription,
        `Campaign discount: ${packageDiscountPercent}% off package (first month)`,
      ]
        .filter(Boolean)
        .join("\n");
    }
    items.push(packageLine);

    const extraTvLine = buildExtraTvLineItem(customer, {
      includeCustomerNumber: b2b,
    });
    if (extraTvLine) items.push(extraTvLine);
  }

  if (options.includeOneTimeDstvFee === true) {
    const decoderLine = buildDstvDecoderFeeLineItem(customer, {
      // C2B signup: short name; B2B managed-house line already identifies the house.
      name: b2b ? undefined : "Decoder charge",
    });
    if (decoderLine) {
      if (options.appliesToDecoder === true && packageDiscountPercent > 0) {
        decoderLine.discount = packageDiscountPercent;
      }
      items.push(decoderLine);
    }
  }

  return items;
}

module.exports = {
  buildSubscriptionLineItems,
  buildDstvDecoderFeeLineItem,
  buildExtraTvLineItem,
  customerHasDstv,
  resolveDstvOneTimeFee,
  shouldIncludeDstvOneTimeFee,
  packageIncludesTvService,
  extraTvUnitFee,
  extraTvCount,
  extraTvAmount,
  extraTvLineName,
  normalizeTvCount,
  resolveTvCountForProduct,
  isExtraTvLineItem,
  mergeRecurringLineItems,
  resolveAdvancePaymentCoverage,
  expectedSignupInvoiceTotal,
  buildAdvancePaymentInvoiceNotes,
  discountedPackageAmount,
  normalizePackageDiscountPercent,
  DSTV_ONE_TIME_FEE,
  EXTRA_TV_UNIT_FEE,
  MAX_TV_COUNT,
};
