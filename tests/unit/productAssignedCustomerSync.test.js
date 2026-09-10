const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  isProductBillingRelevantChange,
  productFrequencyChanged,
  emptyBillingSync,
} = require("../../api/utils/productBillingChange");

const base = {
  price: 3900,
  monthlyPrice: 3900,
  mbps: 100,
  extraBandwidth: 0,
  name: "Basic - Internet + Apartonet Channels",
  paymentFrequency: "monthly",
  planVariantId: 1,
  hasDstv: 0,
};

describe("product billing change detection", () => {
  it("treats price changes as billing-relevant", () => {
    assert.equal(
      isProductBillingRelevantChange(base, { ...base, price: 4500 }),
      true
    );
  });

  it("ignores status-only edits", () => {
    assert.equal(
      isProductBillingRelevantChange(
        { ...base, isActive: 1 },
        { ...base, isActive: 0 }
      ),
      false
    );
  });

  it("treats speed, extra bandwidth, and plan changes as billing-relevant", () => {
    assert.equal(
      isProductBillingRelevantChange(base, { ...base, mbps: 150 }),
      true
    );
    assert.equal(
      isProductBillingRelevantChange(base, { ...base, extraBandwidth: 50 }),
      true
    );
    assert.equal(
      isProductBillingRelevantChange(base, { ...base, planVariantId: 2 }),
      true
    );
  });

  it("detects payment frequency changes", () => {
    assert.equal(
      productFrequencyChanged(base, { ...base, paymentFrequency: "quarterly" }),
      true
    );
    assert.equal(productFrequencyChanged(base, { ...base }), false);
  });

  it("starts with an empty billing sync summary", () => {
    const summary = emptyBillingSync();
    assert.equal(summary.customers, 0);
    assert.equal(summary.zohoUpdated, 0);
    assert.equal(summary.zohoFailed, 0);
  });
});
