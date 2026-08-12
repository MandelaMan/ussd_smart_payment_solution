const { describe, it } = require("node:test");
const { assert, daysFromNow } = require("../helpers");
const {
  calculateUpgradeQuote,
  calculateDowngradeQuote,
  estimateDueDateFromLastPayment,
  recommendPaymentMethod,
} = require("../../api/utils/upgradeQuote");
const { classifyPackageChangeByPrice } = require("../../api/utils/packageChange");

const NOW = new Date("2026-08-12T09:00:00+03:00");

describe("package change classification", () => {
  it("detects upgrade / downgrade / same price", () => {
    assert.equal(classifyPackageChangeByPrice(3000, 4500).isUpgrade, true);
    assert.equal(classifyPackageChangeByPrice(4500, 3000).isDowngrade, true);
    assert.equal(classifyPackageChangeByPrice(3000, 3000).isSamePrice, true);
  });
});

describe("upgrade quote (process: Upgrade package)", () => {
  it("prorates same-frequency price increase for days remaining", () => {
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
    assert.equal(quote.frequencyChanged, false);
    assert.equal(quote.paymentRequired, true);
    assert.equal(quote.topUpAmount, Math.round((1500 * 10) / 30));
    assert.equal(quote.recommendedPaymentMethod, "stk");
  });

  it("recommends invoice for B2B top-ups", () => {
    const quote = calculateUpgradeQuote({
      currentPrice: 3000,
      newPrice: 6000,
      paymentFrequency: "monthly",
      currentPaymentFrequency: "monthly",
      subscriptionStatus: "Active",
      dueDate: daysFromNow(10, NOW),
      customerType: "B2B",
      now: NOW,
    });
    assert.equal(quote.recommendedPaymentMethod, "invoice");
  });

  it("credits unused days when frequency changes monthly → yearly", () => {
    const quote = calculateUpgradeQuote({
      currentPrice: 3000,
      newPrice: 30000,
      paymentFrequency: "yearly",
      currentPaymentFrequency: "monthly",
      subscriptionStatus: "Active",
      dueDate: daysFromNow(10, NOW),
      customerType: "C2B",
      now: NOW,
    });
    assert.equal(quote.frequencyChanged, true);
    assert.equal(quote.remainingCredit, Math.round((3000 * 10) / 30));
    assert.equal(quote.topUpAmount, 30000 - quote.remainingCredit);
  });

  it("charges full new price when subscription is not active", () => {
    const quote = calculateUpgradeQuote({
      currentPrice: 3000,
      newPrice: 4500,
      paymentFrequency: "monthly",
      subscriptionStatus: "Suspended",
      dueDate: daysFromNow(10, NOW),
      customerType: "C2B",
      now: NOW,
    });
    assert.equal(quote.topUpAmount, 4500);
    assert.equal(quote.isActive, false);
  });

  it("no top-up when new price is not higher", () => {
    const quote = calculateUpgradeQuote({
      currentPrice: 4500,
      newPrice: 3000,
      paymentFrequency: "monthly",
      subscriptionStatus: "Active",
      dueDate: daysFromNow(10, NOW),
      customerType: "C2B",
      now: NOW,
    });
    assert.equal(quote.paymentRequired, false);
    assert.equal(quote.topUpAmount, 0);
  });
});

describe("downgrade quote (process: Downgrade package)", () => {
  it("issues prorated credit for same-frequency price drop", () => {
    const quote = calculateDowngradeQuote({
      currentPrice: 4500,
      newPrice: 3000,
      paymentFrequency: "monthly",
      currentPaymentFrequency: "monthly",
      subscriptionStatus: "Active",
      dueDate: daysFromNow(15, NOW),
      customerType: "C2B",
      now: NOW,
    });
    assert.equal(quote.creditAmount, Math.round((1500 * 15) / 30));
    assert.equal(quote.topUpAmount, 0);
  });

  it("no credit when past due", () => {
    const quote = calculateDowngradeQuote({
      currentPrice: 4500,
      newPrice: 3000,
      paymentFrequency: "monthly",
      subscriptionStatus: "Active",
      dueDate: daysFromNow(-2, NOW),
      customerType: "C2B",
      now: NOW,
    });
    assert.equal(quote.creditAmount, 0);
  });
});

describe("payment method recommendation + due estimate", () => {
  it("recommendPaymentMethod rules", () => {
    assert.equal(
      recommendPaymentMethod({ customerType: "C2B", daysUntilDue: 3, topUpAmount: 100 }),
      "stk"
    );
    assert.equal(
      recommendPaymentMethod({ customerType: "C2B", daysUntilDue: 20, topUpAmount: 100 }),
      "invoice"
    );
    assert.equal(
      recommendPaymentMethod({ customerType: "C2B", daysUntilDue: 3, topUpAmount: 0 }),
      "none"
    );
  });

  it("estimateDueDateFromLastPayment adds frequency period", () => {
    assert.equal(
      estimateDueDateFromLastPayment("2026-07-01", "monthly"),
      "2026-07-31"
    );
    assert.equal(
      estimateDueDateFromLastPayment("2026-01-01", "yearly"),
      "2027-01-01"
    );
  });
});
