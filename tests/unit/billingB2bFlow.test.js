const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  computeBillingPeriod,
  computeInvoiceDueDate,
  resolveZohoPaymentTerms,
  computeTrialEndDate,
  computeServiceDueDate,
  computeRecurringStartBeforeDue,
  computeSignupRecurringWindow,
  resolveTispDueDateForEditBilling,
  buildRecurringSubscriptionInvoiceDescription,
  INVOICE_DUE_DAYS,
  TRIAL_PERIOD_DAYS,
  RECURRING_LEAD_DAYS_BEFORE_DUE,
} = require("../../api/utils/billingPeriod");
const {
  isB2BCustomer,
  getZohoContactLookupKeys,
  filterAgencyInvoicesForCustomer,
  resolveEffectiveCustomerEmail,
  resolveEffectiveCustomerPhone,
  applyAgencyUnitDiscount,
  normalizeAgencyDiscountPercent,
  buildManagedHouseLineItemName,
} = require("../../api/utils/b2bBilling");

describe("billing period + invoice terms", () => {
  const anchor = "2026-07-07T10:00:00+03:00";

  it("monthly is calendar month-to-month", () => {
    const period = computeBillingPeriod({
      anchorDate: anchor,
      paymentFrequency: "monthly",
      timeZone: "Africa/Nairobi",
    });
    assert.equal(period.startDate, "2026-07-07");
    assert.equal(period.endDate, "2026-08-07");
  });

  it("quarterly / yearly / custom windows", () => {
    assert.equal(
      computeBillingPeriod({
        anchorDate: anchor,
        paymentFrequency: "quarterly",
        timeZone: "Africa/Nairobi",
      }).endDate,
      "2026-10-07"
    );
    assert.equal(
      computeBillingPeriod({
        anchorDate: anchor,
        paymentFrequency: "yearly",
        timeZone: "Africa/Nairobi",
      }).endDate,
      "2027-07-07"
    );
    assert.equal(
      computeBillingPeriod({
        anchorDate: anchor,
        paymentFrequency: "custom",
        customPeriodDays: 45,
        timeZone: "Africa/Nairobi",
      }).endDate,
      "2026-08-21"
    );
  });

  it("C2B invoice due is Net 7; B2B is Net 30", () => {
    assert.equal(INVOICE_DUE_DAYS.c2b, 7);
    assert.equal(INVOICE_DUE_DAYS.b2b, 30);
    assert.equal(
      computeInvoiceDueDate({ customer_type: "C2B" }, anchor, "Africa/Nairobi"),
      "2026-07-14"
    );
    assert.equal(
      computeInvoiceDueDate({ customerType: "B2B" }, anchor, "Africa/Nairobi"),
      "2026-08-06"
    );
    assert.deepEqual(resolveZohoPaymentTerms({ customer_type: "C2B" }), {
      payment_terms: 7,
      payment_terms_label: "Net 7",
    });
  });

  it("trial ends after TRIAL_PERIOD_DAYS", () => {
    assert.equal(TRIAL_PERIOD_DAYS, 30);
    assert.equal(computeTrialEndDate(anchor, "Africa/Nairobi"), "2026-08-06");
  });

  it("service due date mirrors billing period end", () => {
    assert.equal(
      computeServiceDueDate({
        anchorDate: anchor,
        paymentFrequency: "monthly",
        timeZone: "Africa/Nairobi",
      }),
      "2026-08-07"
    );
  });

  it("recurring starts RECURRING_LEAD_DAYS before due", () => {
    assert.equal(RECURRING_LEAD_DAYS_BEFORE_DUE, 7);
    assert.equal(
      computeRecurringStartBeforeDue("2026-08-07", 7, "Africa/Nairobi"),
      "2026-07-31"
    );
  });

  it("signup recurring invoices 7 days before next service due, not Net 7 + 1 month", () => {
    const window = computeSignupRecurringWindow({
      signupDate: "2026-08-14T12:00:00+03:00",
      paymentFrequency: "monthly",
      timeZone: "Africa/Nairobi",
    });
    assert.equal(window.nextCycleDue, "2026-09-14");
    assert.equal(window.startDate, "2026-09-07");
  });

  it("edit billing reset: signup invoice uses Net 7, recurring-only uses next service due", () => {
    const customer = { customerType: "C2B", paymentFrequency: "monthly" };
    const anchor = "2026-08-14T12:00:00+03:00";
    assert.equal(
      resolveTispDueDateForEditBilling({
        customer,
        createInitialInvoice: true,
        updateZohoRecurring: true,
        anchorDate: anchor,
        timeZone: "Africa/Nairobi",
      }),
      "2026-08-21"
    );
    assert.equal(
      resolveTispDueDateForEditBilling({
        customer,
        updateZohoRecurring: true,
        anchorDate: anchor,
        timeZone: "Africa/Nairobi",
      }),
      "2026-09-14"
    );
    assert.equal(
      resolveTispDueDateForEditBilling({
        customer,
        createInitialInvoice: true,
        invoice: { dueDate: "2026-08-22" },
        anchorDate: anchor,
        timeZone: "Africa/Nairobi",
      }),
      "2026-08-22"
    );
    assert.equal(
      resolveTispDueDateForEditBilling({
        customer,
        anchorDate: anchor,
        timeZone: "Africa/Nairobi",
      }),
      null
    );
  });

  it("builds Zoho recurring description placeholders", () => {
    assert.match(
      buildRecurringSubscriptionInvoiceDescription("monthly"),
      /%\(d\)% %\(m\)% %\(y\)%/
    );
    assert.match(
      buildRecurringSubscriptionInvoiceDescription("yearly"),
      /%\(y\+1\)%/
    );
  });
});

describe("B2B agency billing rules", () => {
  it("detects B2B customers", () => {
    assert.equal(isB2BCustomer({ customer_type: "B2B" }), true);
    assert.equal(isB2BCustomer({ customerType: "C2B" }), false);
  });

  it("C2B Zoho lookup prefers customer number then contact fields", () => {
    const keys = getZohoContactLookupKeys({
      customerNumber: "ET-401A",
      email: "a@example.com",
      phone: "0712345678",
      firstName: "Ann",
      lastName: "Wanjiku",
    });
    assert.equal(keys[0], "ET-401A");
    assert.ok(keys.includes("a@example.com"));
    assert.ok(keys.includes("0712345678"));
    assert.ok(keys.includes("254712345678"));
  });

  it("B2B Zoho lookup uses agency name only", () => {
    assert.deepEqual(
      getZohoContactLookupKeys({
        customer_type: "B2B",
        agencyName: "Acme Housing",
        customerNumber: "ETB-401A",
      }),
      ["Acme Housing"]
    );
  });

  it("filters agency invoices to the managed house reference", () => {
    const invoices = [
      { invoiceNumber: "INV-1", reference_number: "ETB-401A" },
      { invoiceNumber: "INV-2", reference_number: "ETB-502B" },
    ];
    const matched = filterAgencyInvoicesForCustomer(invoices, "ETB-401A");
    assert.equal(matched.length, 1);
    assert.equal(matched[0].invoiceNumber, "INV-1");
  });

  it("falls back to agency email/phone for B2B without personal contact", () => {
    const customer = { customer_type: "B2B", email: "", phone: "" };
    const agency = { email: "billing@agency.co.ke", phone: "0700111222" };
    assert.equal(
      resolveEffectiveCustomerEmail(customer, agency),
      "billing@agency.co.ke"
    );
    assert.equal(resolveEffectiveCustomerPhone(customer, agency), "0700111222");
  });

  it("applies agency unit discount", () => {
    assert.equal(normalizeAgencyDiscountPercent(14.88), 14.88);
    assert.equal(normalizeAgencyDiscountPercent(0), null);
    assert.equal(applyAgencyUnitDiscount(6950, 14.88), 5916);
  });

  it("builds managed-house line item name", () => {
    const name = buildManagedHouseLineItemName({
      buildingName: "Tanga",
      apartmentNumber: "401A",
      productName: "Home Fibre",
      productMbps: 20,
    });
    assert.match(name, /Tanga/);
    assert.match(name, /Apt 401A/);
    assert.match(name, /Home Fibre/);
  });
});
