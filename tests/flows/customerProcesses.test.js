/**
 * End-to-end *logic* scenarios for documented customer processes.
 * These assert the pure decision rules that drive Local/TISP/Zoho/OLT outcomes
 * (see docs/CUSTOMER_PROCESSES.md) without hitting live integrations.
 */
const { describe, it } = require("node:test");
const { assert, daysFromNow } = require("../helpers");
const {
  buildCustomerNumber,
  liveCustomerNumber,
  archiveCancelledCustomerNumber,
  isValidPaybillAccountRef,
} = require("../../api/utils/customerNumber");
const {
  calculateUpgradeQuote,
  calculateDowngradeQuote,
} = require("../../api/utils/upgradeQuote");
const { classifyPackageChangeByPrice } = require("../../api/utils/packageChange");
const {
  computeInvoiceDueDate,
  computeServiceDueDate,
  computeRecurringStartBeforeDue,
  computeSignupRecurringWindow,
} = require("../../api/utils/billingPeriod");
const {
  isB2BCustomer,
  getZohoContactLookupKeys,
  applyAgencyUnitDiscount,
} = require("../../api/utils/b2bBilling");
const { normalizeSubscriptionStatus } = require("../../api/utils/subscriptionStatus");
const { findTargetOpenInvoice } = require("../../api/utils/mpesaInvoiceMatching");
const { planInvoicePayment } = require("../../api/utils/mpesaPaymentPlan");
const { detectBillingScenarios } = require("../../api/utils/reconciliationEngine");

const NOW = new Date("2026-08-12T09:00:00+03:00");

describe("process: Convert C2B ↔ B2B numbering + Zoho contact target", () => {
  const building = {
    c2b_code: "CL",
    b2b_code: "CLB",
    building_code: "",
  };

  it("renumbers CL-A10 ↔ CLB-A10 and switches Zoho lookup target", () => {
    const c2bNumber = buildCustomerNumber(building, "C2B", "A10");
    const b2bNumber = buildCustomerNumber(building, "B2B", "A10");
    assert.equal(c2bNumber, "CL-A10");
    assert.equal(b2bNumber, "CLB-A10");

    const c2bKeys = getZohoContactLookupKeys({
      customer_type: "C2B",
      customerNumber: c2bNumber,
      email: "tenant@example.com",
    });
    assert.equal(c2bKeys[0], "CL-A10");

    const b2bKeys = getZohoContactLookupKeys({
      customer_type: "B2B",
      customerNumber: b2bNumber,
      agencyName: "City Agency",
    });
    assert.deepEqual(b2bKeys, ["City Agency"]);
    assert.equal(isB2BCustomer({ customer_type: "B2B" }), true);
  });

  it("after convert to C2B, Zoho lookup is the personal number not the agency", () => {
    const afterConvert = getZohoContactLookupKeys({
      customer_type: "C2B",
      customerNumber: "CL-A10",
      email: "tenant@example.com",
      agencyName: "City Agency",
    });
    assert.equal(afterConvert[0], "CL-A10");
    assert.equal(afterConvert.includes("City Agency"), false);
    assert.equal(isB2BCustomer({ customer_type: "C2B" }), false);
  });
});

describe("process: Cancel → new tenant on same apartment", () => {
  it("archives old number and frees live number for reuse", () => {
    const live = "ET-H302";
    const archived = archiveCancelledCustomerNumber(live, 237);
    assert.equal(archived, "ET-H302-CXL-237");
    assert.equal(liveCustomerNumber(archived), "ET-H302");
    assert.equal(isValidPaybillAccountRef(archived), false);
    assert.equal(isValidPaybillAccountRef(live), true);
  });
});

describe("process: Upgrade with pending M-Pesa top-up completion", () => {
  it("computes STK top-up then applies payment to matching invoice", () => {
    const quote = calculateUpgradeQuote({
      currentPrice: 3000,
      newPrice: 4500,
      paymentFrequency: "monthly",
      currentPaymentFrequency: "monthly",
      subscriptionStatus: "Active",
      dueDate: daysFromNow(10, NOW),
      customerType: "C2B",
      now: NOW,
    });
    assert.equal(quote.recommendedPaymentMethod, "stk");
    assert.ok(quote.topUpAmount > 0);

    const invoice = {
      invoice_id: "up-1",
      status: "sent",
      balance: quote.topUpAmount,
      reference_number: "ET-401A",
    };
    const target = findTargetOpenInvoice([invoice], "ET-401A", quote.topUpAmount);
    assert.equal(target?.invoice_id, "up-1");

    const plan = planInvoicePayment(quote.topUpAmount, invoice.balance);
    assert.equal(plan.outcome, "paid_in_full");
  });
});

describe("process: Downgrade issues credit; frequency change classifies by price", () => {
  it("same-frequency downgrade yields credit, not top-up", () => {
    assert.equal(classifyPackageChangeByPrice(4500, 3000).isDowngrade, true);
    const quote = calculateDowngradeQuote({
      currentPrice: 4500,
      newPrice: 3000,
      paymentFrequency: "monthly",
      currentPaymentFrequency: "monthly",
      subscriptionStatus: "Active",
      dueDate: daysFromNow(20, NOW),
      customerType: "C2B",
      now: NOW,
    });
    assert.ok(quote.creditAmount > 0);
    assert.equal(quote.paymentRequired, false);
  });
});

describe("process: Pause vs Suspend status semantics", () => {
  it("Paused and Suspended normalize distinctly; cancel archives identity", () => {
    assert.equal(normalizeSubscriptionStatus("Paused"), "Paused");
    assert.equal(normalizeSubscriptionStatus("Suspended"), "Suspended");
    // Resume is payment-driven — paid+disconnected is the ops signal
    const scenarios = detectBillingScenarios({
      customer: { status: "active" },
      accountStatus: "active",
      subscriptionStatus: "Suspended",
      serviceActive: false,
      serviceDisconnected: true,
      serviceUnknown: false,
      outstandingBalance: 0,
      overdueInvoices: [],
      overdueCount: 0,
      openInvoiceCount: 0,
      expectedAmount: 3000,
      lastPaymentAmount: 3000,
      monthlyPrice: 3000,
      invoices: [],
      mpesaPayments: [],
      unmatchedMpesa: [],
      recentUnmatchedMpesa: [],
      recurring: {},
      billedViaAgency: false,
      zohoLinked: true,
      creditBalance: 0,
      partialInvoices: [],
      zohoPayments: [],
      skippedPayment: { skipped: false },
    });
    assert.ok(scenarios.statuses.includes("paid_but_disconnected"));
  });
});

describe("process: Signup billing window (C2B vs B2B agency)", () => {
  it("C2B Net 7 + service due + recurring lead; B2B Net 30 + discount", () => {
    const anchor = "2026-08-12T08:00:00+03:00";
    assert.equal(
      computeInvoiceDueDate({ customer_type: "C2B" }, anchor, "Africa/Nairobi"),
      "2026-08-19"
    );
    assert.equal(
      computeInvoiceDueDate({ customerType: "B2B" }, anchor, "Africa/Nairobi"),
      "2026-09-11"
    );
    const serviceDue = computeServiceDueDate({
      anchorDate: anchor,
      paymentFrequency: "monthly",
      timeZone: "Africa/Nairobi",
    });
    assert.equal(serviceDue, "2026-09-12");
    assert.equal(
      computeRecurringStartBeforeDue(serviceDue, 7, "Africa/Nairobi"),
      "2026-09-05"
    );
    const window = computeSignupRecurringWindow({
      signupDate: anchor,
      paymentFrequency: "monthly",
      timeZone: "Africa/Nairobi",
    });
    assert.equal(window.nextCycleDue, "2026-09-12");
    assert.equal(window.startDate, "2026-09-05");
    assert.equal(applyAgencyUnitDiscount(10000, 10), 9000);
  });
});

describe("process: Paybill C2B confirmation matching path", () => {
  it("accepts multi-POP refs and allocates oldest affordable open invoice", () => {
    assert.equal(isValidPaybillAccountRef("AZE-TGA-401A"), true);
    const target = findTargetOpenInvoice(
      [
        {
          invoice_id: "old",
          status: "overdue",
          balance: 2000,
          date: "2026-06-01",
          reference_number: "OTHER",
        },
        {
          invoice_id: "new",
          status: "sent",
          balance: 5000,
          date: "2026-07-01",
          reference_number: "OTHER",
        },
      ],
      "NO-REF",
      2500
    );
    assert.equal(target?.invoice_id, "old");
    assert.equal(planInvoicePayment(2500, 2000).outcome, "paid_with_excess_credit");
  });
});
