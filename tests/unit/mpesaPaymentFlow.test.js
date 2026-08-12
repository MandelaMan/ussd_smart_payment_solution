const { describe, it } = require("node:test");
const { assert, assertOutcome } = require("../helpers");
const {
  findTargetOpenInvoice,
  invoiceMatchesCustomerRef,
  roundMoney,
  amountsEqual,
  isUnpaidLikeInvoice,
} = require("../../api/utils/mpesaInvoiceMatching");
const { planInvoicePayment } = require("../../api/utils/mpesaPaymentPlan");

describe("M-Pesa → Zoho invoice matching", () => {
  const invoices = [
    {
      invoice_id: "1",
      status: "sent",
      balance: 1500,
      reference_number: "ET-ABC",
      invoice_number: "INV-001",
      date: "2026-07-01",
    },
    {
      invoice_id: "2",
      status: "sent",
      balance: 2000,
      reference_number: "OTHER",
      date: "2026-07-15",
    },
    {
      invoice_id: "3",
      status: "paid",
      balance: 0,
      reference_number: "ET-ABC",
    },
  ];

  it("matches by customer reference first", () => {
    const hit = findTargetOpenInvoice(invoices, "ET-ABC", 999);
    assert.equal(hit?.invoice_id, "1");
  });

  it("matches by exact outstanding balance when ref misses", () => {
    const hit = findTargetOpenInvoice(
      [{ invoice_id: "9", status: "overdue", balance: 500 }],
      "ET-XYZ",
      500
    );
    assert.equal(hit?.invoice_id, "9");
  });

  it("selects the only open invoice", () => {
    const hit = findTargetOpenInvoice(
      [{ invoice_id: "7", status: "sent", balance: 1200 }],
      "ET-ONE",
      800
    );
    assert.equal(hit?.invoice_id, "7");
  });

  it("matches invoice_number containing customer ref", () => {
    assert.equal(
      invoiceMatchesCustomerRef({ invoice_number: "BLD-ET-99" }, "ET-99"),
      true
    );
  });

  it("ignores paid invoices", () => {
    assert.equal(isUnpaidLikeInvoice({ status: "paid" }), false);
    const hit = findTargetOpenInvoice(
      [{ invoice_id: "3", status: "paid", balance: 0, reference_number: "ET-ABC" }],
      "ET-ABC",
      100
    );
    assert.equal(hit, null);
  });

  it("prefers oldest full-pay candidate when multiple open", () => {
    const hit = findTargetOpenInvoice(
      [
        { invoice_id: "a", status: "sent", balance: 3000, date: "2026-06-01" },
        { invoice_id: "b", status: "sent", balance: 800, date: "2026-07-01" },
      ],
      "NO-MATCH",
      1000
    );
    assert.equal(hit?.invoice_id, "b");
  });

  it("rounds money to cents", () => {
    assert.equal(roundMoney(10.005), 10.01);
    assert.equal(amountsEqual(10, 10.004), true);
  });
});

describe("M-Pesa payment plan against invoice balance", () => {
  it("exact pay → paid_in_full", () => {
    assertOutcome(planInvoicePayment(1500, 1500), "paid_in_full", {
      amount_applied: 1500,
      excess_amount: 0,
    });
  });

  it("underpay → partially_paid with remaining", () => {
    const plan = planInvoicePayment(500, 1500);
    assertOutcome(plan, "partially_paid", {
      amount_applied: 500,
      excess_amount: 0,
      remaining_balance: 1000,
    });
  });

  it("overpay → paid_with_excess_credit", () => {
    assertOutcome(planInvoicePayment(2000, 1500), "paid_with_excess_credit", {
      amount_applied: 1500,
      excess_amount: 500,
    });
  });

  it("zero/negative balance still records payment amount", () => {
    assertOutcome(planInvoicePayment(100, 0), "paid_in_full", {
      amount_applied: 100,
      excess_amount: 0,
    });
  });
});
