const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  packageIncludesTvService,
  extraTvCount,
  extraTvAmount,
  buildExtraTvLineItem,
  buildSubscriptionLineItems,
  expectedSignupInvoiceTotal,
  isExtraTvLineItem,
  mergeRecurringLineItems,
  normalizeTvCount,
  resolveTvCountForProduct,
} = require("../../api/utils/zohoInvoiceLineItems");

describe("extra TV billing", () => {
  const tvCustomer = {
    categoryCode: "internet_apartonet",
    packagePrice: 5000,
    tvCount: 2,
    paymentFrequency: "monthly",
    productName: "Apartonet 10",
    productMbps: 10,
  };

  it("treats internet only as no TV service", () => {
    assert.equal(
      packageIncludesTvService({ categoryCode: "internet_only" }),
      false
    );
    assert.equal(
      extraTvCount({ categoryCode: "internet_only", tvCount: 5 }),
      0
    );
    assert.equal(
      buildExtraTvLineItem({ categoryCode: "internet_only", tvCount: 5 }),
      null
    );
  });

  it("defaults TV count to 1 and ignores extra TVs on internet only products", () => {
    assert.equal(normalizeTvCount(undefined, true), 1);
    assert.equal(
      resolveTvCountForProduct({ category_code: "internet_only" }, 4),
      1
    );
    assert.equal(
      resolveTvCountForProduct({ category_code: "internet_apartonet" }, 3),
      3
    );
  });

  it("adds 500 per TV above the first", () => {
    assert.equal(extraTvCount({ ...tvCustomer, tvCount: 1 }), 0);
    assert.equal(extraTvAmount({ ...tvCustomer, tvCount: 1 }), 0);
    assert.equal(extraTvCount(tvCustomer), 1);
    assert.equal(extraTvAmount(tvCustomer), 500);
    assert.equal(extraTvAmount({ ...tvCustomer, tvCount: 3 }), 1000);
  });

  it("builds an Extra TV invoice line with quantity of extra TVs", () => {
    const line = buildExtraTvLineItem(tvCustomer);
    assert.equal(line.name, "Extra TV");
    assert.equal(line.rate, 500);
    assert.equal(line.quantity, 1);
    const two = buildExtraTvLineItem({ ...tvCustomer, tvCount: 3 });
    assert.equal(two.name, "Extra TVs");
    assert.equal(two.quantity, 2);
  });

  it("puts Extra TV on signup and recurring package invoices", () => {
    const signup = buildSubscriptionLineItems(tvCustomer, {}, {
      includeOneTimeDstvFee: true,
    });
    const extra = signup.find((item) => isExtraTvLineItem(item));
    assert.ok(extra);
    assert.equal(extra.rate, 500);

    const recurring = buildSubscriptionLineItems(tvCustomer, {}, {
      includeOneTimeDstvFee: false,
    });
    assert.ok(recurring.some((item) => isExtraTvLineItem(item)));
  });

  it("includes extra TV in expected signup total but not campaign discount", () => {
    assert.equal(expectedSignupInvoiceTotal(tvCustomer), 5500);
    assert.equal(
      expectedSignupInvoiceTotal(tvCustomer, { packageDiscountPercent: 50 }),
      2500 + 500
    );
  });

  it("does not put Extra TV on a decoder-only invoice", () => {
    const items = buildSubscriptionLineItems(tvCustomer, {}, {
      includePackage: false,
      includeOneTimeDstvFee: true,
    });
    assert.equal(items.some((item) => isExtraTvLineItem(item)), false);
  });

  it("merges Extra TV by name and deletes leftover extra TV lines", () => {
    const existing = [
      { line_item_id: "pkg-1", name: "Apartonet 10 Mbps" },
      { line_item_id: "tv-1", name: "Extra TV" },
    ];
    const withoutExtra = mergeRecurringLineItems(existing, [
      { name: "Apartonet 10 Mbps", rate: 5000, quantity: 1 },
    ]);
    assert.equal(withoutExtra.length, 2);
    assert.equal(withoutExtra[0].line_item_id, "pkg-1");
    assert.equal(withoutExtra[1].line_item_id, "tv-1");
    assert.equal(withoutExtra[1].delete, true);

    const withExtra = mergeRecurringLineItems(
      [{ line_item_id: "pkg-1", name: "Apartonet 10 Mbps" }],
      [
        { name: "Apartonet 10 Mbps", rate: 5000, quantity: 1 },
        { name: "Extra TV", rate: 500, quantity: 1 },
      ]
    );
    assert.equal(withExtra[0].line_item_id, "pkg-1");
    assert.equal(withExtra[1].line_item_id, undefined);
    assert.equal(withExtra[1].name, "Extra TV");
  });
});
