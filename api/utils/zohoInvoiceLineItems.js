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
      customer?.product_has_dstv
  );
}

function resolveDstvOneTimeFee(customer) {
  const fromCustomer = Number(customer.decoderFeeAmount);
  if (fromCustomer > 0) return fromCustomer;
  return DSTV_ONE_TIME_FEE;
}

function shouldIncludeDstvOneTimeFee(customer) {
  return customerHasDstv(customer) || Boolean(customer.decoderFeeRequired);
}

/**
 * Build Zoho invoice line items for a subscription period.
 * DSTV (KES 2,900 one-time) is only added when includeOneTimeDstvFee is true (first signup invoice).
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

  if (
    options.includeOneTimeDstvFee === true &&
    shouldIncludeDstvOneTimeFee(customer)
  ) {
    const fee = resolveDstvOneTimeFee(customer);
    if (fee > 0) {
      const serial = customer.dstvDecoderSerial
        ? String(customer.dstvDecoderSerial).trim()
        : "";
      items.push(
        withTax({
          name: "DSTV one-time fee",
          rate: fee,
          quantity: 1,
          description: serial
            ? `One-time DSTV charge (decoder serial: ${serial})`
            : "One-time DSTV charge (lifetime)",
        })
      );
    }
  }

  return items;
}

module.exports = {
  buildSubscriptionLineItems,
  customerHasDstv,
  resolveDstvOneTimeFee,
  shouldIncludeDstvOneTimeFee,
};
