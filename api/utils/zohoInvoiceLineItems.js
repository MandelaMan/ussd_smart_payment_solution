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

/** Expected signup invoice total: package price + one-time decoder when DSTV. */
function expectedSignupInvoiceTotal(customer) {
  const packagePrice = Number(customer?.packagePrice || customer?.package_price || 0);
  if (!(packagePrice > 0)) return 0;
  if (!shouldIncludeDstvOneTimeFee(customer)) return packagePrice;
  return packagePrice + resolveDstvOneTimeFee(customer);
}

/**
 * Build Zoho invoice line items for a subscription period.
 * Decoder charge is added when includeOneTimeDstvFee is true (signup / first invoice).
 * Recurring profiles must pass includeOneTimeDstvFee: false (default).
 */
function buildSubscriptionLineItems(customer, period, options = {}) {
  const items = [];
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

  items.push(
    withTax({
      name: lineName,
      rate: packagePrice,
      quantity: 1,
      description: periodDescription,
    })
  );

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
  expectedSignupInvoiceTotal,
  DSTV_ONE_TIME_FEE,
};
