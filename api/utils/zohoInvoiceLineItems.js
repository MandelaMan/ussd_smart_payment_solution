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

const ZOHO_VAT_TAX_ID = process.env.ZOHO_VAT_TAX_ID || null;
const DSTV_ONE_TIME_FEE = Number(process.env.ZOHO_DSTV_ONE_TIME_FEE || 2900);

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
  return (
    customerHasDstv(customer) ||
    Boolean(customer?.decoderFeeRequired) ||
    Boolean(customer?.decoder_fee_required)
  );
}

/**
 * Resolve which signup line items an advance payment covers.
 * Every package asks what the payment covers (Internet/package).
 * DSTV packages also allow a separate decoder allocation.
 */
function resolveAdvancePaymentCoverage(customer, options = {}) {
  const hasDstv = shouldIncludeDstvOneTimeFee(customer);
  const paymentAlreadyMade = options.paymentAlreadyMade === true;

  if (!paymentAlreadyMade) {
    return {
      includePackage: true,
      includeDecoder: hasDstv,
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

  let total = 0;
  if (coverage.includePackage) {
    total += Number(customer?.packagePrice || customer?.package_price || 0);
  }
  if (coverage.includeDecoder && shouldIncludeDstvOneTimeFee(customer)) {
    total += resolveDstvOneTimeFee(customer);
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
  if (coverage?.includePackage) {
    lines.push(`Package (from plan): KES ${Math.round(packagePrice)}`);
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
      `Internet/package not included in this payment — still outstanding (KES ${Math.round(packagePrice)})`
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

  if (includePackage) {
    items.push(
      withTax({
        name: lineName,
        rate: packagePrice,
        quantity: 1,
        description: periodDescription,
      })
    );
  }

  if (options.includeOneTimeDstvFee === true) {
    const decoderLine = buildDstvDecoderFeeLineItem(customer, {
      // C2B signup: short name; B2B managed-house line already identifies the house.
      name: b2b ? undefined : "Decoder charge",
    });
    if (decoderLine) items.push(decoderLine);
  }

  return items;
}

module.exports = {
  buildSubscriptionLineItems,
  buildDstvDecoderFeeLineItem,
  customerHasDstv,
  resolveDstvOneTimeFee,
  shouldIncludeDstvOneTimeFee,
  resolveAdvancePaymentCoverage,
  expectedSignupInvoiceTotal,
  buildAdvancePaymentInvoiceNotes,
  DSTV_ONE_TIME_FEE,
};
