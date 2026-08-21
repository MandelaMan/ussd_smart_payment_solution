const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  normalizeSubscriptionStatus,
  subscriptionStatusFilterClause,
  SUBSCRIPTION_STATUSES,
} = require("../../api/utils/subscriptionStatus");
const {
  detectBillingScenarios,
  isActiveService,
  isDisconnectedService,
  isUnknownService,
  aggregateSummary,
} = require("../../api/utils/reconciliationEngine");
const { detectSkippedMonthlyPayment } = require("../../api/utils/skippedPayment");
const {
  isOverdueZohoInvoice,
  isExcludedZohoInvoiceStatus,
  selectOverdueZohoInvoicesToVoid,
} = require("../../api/utils/zohoInvoiceStatus");

describe("subscription status normalization (pause / suspend / cancel)", () => {
  it("canonicalizes known statuses", () => {
    assert.deepEqual(SUBSCRIPTION_STATUSES, [
      "Active",
      "Suspended",
      "Paused",
      "Cancelled",
    ]);
    assert.equal(normalizeSubscriptionStatus("active"), "Active");
    assert.equal(normalizeSubscriptionStatus("Paused — away"), "Paused");
    assert.equal(normalizeSubscriptionStatus("Suspended"), "Suspended");
    assert.equal(normalizeSubscriptionStatus("Cancelled"), "Cancelled");
  });

  it("maps legacy / empty values to Suspended", () => {
    assert.equal(normalizeSubscriptionStatus(""), "Suspended");
    assert.equal(normalizeSubscriptionStatus("Not on TISP"), "Suspended");
    assert.equal(normalizeSubscriptionStatus("unknown"), "Suspended");
  });

  it("builds SQL filter for active accounts", () => {
    const clause = subscriptionStatusFilterClause("active");
    assert.ok(clause.sql.includes("c.status = 'active'"));
    assert.ok(clause.sql.toLowerCase().includes("'active'"));
  });
});

describe("reconciliation scenarios (Zoho vs TISP)", () => {
  const base = {
    customer: { status: "active", paymentFrequency: "monthly" },
    accountStatus: "active",
    subscriptionStatus: "Active",
    serviceActive: true,
    serviceDisconnected: false,
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
    agencyName: null,
    zohoLinked: true,
    zohoError: null,
    tispError: null,
    creditBalance: 0,
    partialInvoices: [],
    tispDueDate: null,
    zohoPayments: [],
    skippedPayment: { skipped: false },
  };

  it("flags active service with Zoho outstanding as connected_without_payment", () => {
    const result = detectBillingScenarios({
      ...base,
      outstandingBalance: 4500,
      overdueCount: 1,
      overdueInvoices: [{ id: "1", balanceDue: 4500 }],
    });
    assert.ok(result.statuses.includes("connected_without_payment"));
  });

  it("flags cancelled account still active on TISP", () => {
    const result = detectBillingScenarios({
      ...base,
      accountStatus: "cancelled",
      customer: { status: "cancelled" },
      serviceActive: true,
    });
    assert.ok(result.statuses.includes("cancelled_still_active"));
  });

  it("flags paid but disconnected", () => {
    const result = detectBillingScenarios({
      ...base,
      serviceActive: false,
      serviceDisconnected: true,
      subscriptionStatus: "Suspended",
      outstandingBalance: 0,
    });
    assert.ok(result.statuses.includes("paid_but_disconnected"));
  });

  it("flags active C2B without Zoho link", () => {
    const result = detectBillingScenarios({
      ...base,
      zohoLinked: false,
    });
    assert.ok(result.statuses.includes("no_zoho_link"));
  });

  it("flags B2B without agency", () => {
    const result = detectBillingScenarios({
      ...base,
      billedViaAgency: true,
      agencyName: null,
    });
    assert.ok(result.statuses.includes("manual_review_required"));
  });

  it("service active/disconnected/unknown helpers", () => {
    assert.equal(isActiveService("Active"), true);
    assert.equal(isDisconnectedService("Suspended"), true);
    assert.equal(isDisconnectedService("Paused"), false);
    assert.equal(isUnknownService("Not on TISP"), true);
    assert.equal(isUnknownService(""), true);
    assert.equal(isUnknownService("Suspended"), false);
    assert.equal(isUnknownService("Active"), false);
  });

  it("aggregates summary counts", () => {
    const summary = aggregateSummary([
      {
        statuses: ["connected_without_payment"],
        metrics: { outstandingBalance: 1000, revenueAtRisk: 1000 },
        customerStatus: "active",
      },
      {
        statuses: ["ok"],
        metrics: { outstandingBalance: 0, revenueAtRisk: 0 },
        customerStatus: "active",
      },
    ]);
    assert.equal(summary.connectedWithoutPayment, 1);
    assert.equal(summary.totalOutstandingBalance, 1000);
  });
});

describe("skipped monthly payment detection", () => {
  it("detects paid then skipped overdue cycle", () => {
    const result = detectSkippedMonthlyPayment({
      customer: { status: "active", paymentFrequency: "monthly" },
      invoices: [
        {
          id: "1",
          invoiceNumber: "INV-1",
          status: "paid",
          total: 3000,
          balance: 0,
          date: "2026-05-01",
        },
        {
          id: "2",
          invoiceNumber: "INV-2",
          status: "overdue",
          total: 3000,
          balance: 3000,
          balanceDue: 3000,
          date: "2026-06-01",
          dueDate: "2026-06-08",
        },
      ],
    });
    assert.equal(result.skipped, true);
    assert.ok(result.message.includes("INV-2"));
  });

  it("ignores customers on active trial", () => {
    const result = detectSkippedMonthlyPayment({
      customer: {
        status: "active",
        paymentFrequency: "monthly",
        trialPeriodEnabled: true,
        trialEndsAt: "2099-01-01",
      },
      invoices: [
        {
          id: "2",
          status: "overdue",
          total: 3000,
          balance: 3000,
          date: "2026-06-01",
          dueDate: "2026-06-08",
        },
      ],
    });
    assert.equal(result.skipped, false);
  });
});

describe("Zoho invoice status helpers", () => {
  it("excludes draft/void and detects overdue", () => {
    assert.equal(isExcludedZohoInvoiceStatus("draft"), true);
    assert.equal(isExcludedZohoInvoiceStatus("void"), true);
    assert.equal(
      isOverdueZohoInvoice({
        status: "sent",
        balance: 100,
        dueDate: "2020-01-01",
      }),
      true
    );
    assert.equal(
      isOverdueZohoInvoice({ status: "paid", balance: 0, dueDate: "2020-01-01" }),
      false
    );
  });

  it("selects only this customer's overdue invoices to void on cancel", () => {
    const agencyContactId = "agency-1";
    const cancelled = {
      customerType: "B2B",
      customerNumber: "ET-H302",
    };
    const invoices = [
      {
        invoice_id: "ov-1",
        customer_id: agencyContactId,
        reference_number: "ET-H302",
        status: "overdue",
        balance: 3500,
        due_date: "2020-01-01",
      },
      {
        invoice_id: "paid-1",
        customer_id: agencyContactId,
        reference_number: "ET-H302",
        status: "paid",
        balance: 0,
        due_date: "2020-01-01",
      },
      {
        invoice_id: "future-1",
        customer_id: agencyContactId,
        reference_number: "ET-H302",
        status: "sent",
        balance: 3500,
        due_date: "2099-01-01",
      },
      {
        invoice_id: "sibling-ov",
        customer_id: agencyContactId,
        reference_number: "ET-H401",
        status: "overdue",
        balance: 3500,
        due_date: "2020-01-01",
      },
      {
        invoice_id: "draft-1",
        customer_id: agencyContactId,
        reference_number: "ET-H302",
        status: "draft",
        balance: 3500,
        due_date: "2020-01-01",
      },
    ];

    const selected = selectOverdueZohoInvoicesToVoid(
      invoices,
      agencyContactId,
      cancelled
    );
    assert.deepEqual(
      selected.map((inv) => inv.invoice_id),
      ["ov-1"]
    );
  });
});
