const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  extraDecoderCount,
  extraDecoderAmount,
  decodersOwnedCount,
  buildExtraDecoderLineItem,
  buildDstvDecoderFeeLineItem,
  buildSubscriptionLineItems,
  expectedSignupInvoiceTotal,
  isExtraDecoderLineItem,
  mergeRecurringLineItems,
  normalizeExtraDecoderCount,
  resolveExtraDecoderCountForProduct,
} = require("../../api/utils/zohoInvoiceLineItems");

describe("extra decoder billing", () => {
  const dstvCustomer = {
    hasDstv: true,
    decoderFeeRequired: true,
    decoderFeeAmount: 2900,
    packagePrice: 9250,
    extraDecoderCount: 2,
    buildingDstvSetup: "decoder",
    paymentFrequency: "monthly",
    productName: "Internet + DSTV",
    productMbps: 80,
  };

  it("normalizes extra decoder count to 0–10", () => {
    assert.equal(normalizeExtraDecoderCount(undefined), 0);
    assert.equal(normalizeExtraDecoderCount(-1), 0);
    assert.equal(normalizeExtraDecoderCount(2.8), 2);
    assert.equal(normalizeExtraDecoderCount(99), 10);
  });

  it("clears extra decoders when the product has no DSTV", () => {
    assert.equal(
      resolveExtraDecoderCountForProduct({ has_dstv: 0 }, 3, {
        dstvSetup: "decoder",
      }),
      0
    );
    assert.equal(
      resolveExtraDecoderCountForProduct({ hasDstv: true }, 3, {
        dstvSetup: "decoder",
      }),
      3
    );
  });

  it("counts 3500 per extra decoder for recurring, not the included decoder", () => {
    assert.equal(extraDecoderCount({ ...dstvCustomer, extraDecoderCount: 0 }), 0);
    assert.equal(extraDecoderAmount({ ...dstvCustomer, extraDecoderCount: 0 }), 0);
    assert.equal(extraDecoderCount(dstvCustomer), 2);
    assert.equal(extraDecoderAmount(dstvCustomer), 7000);
  });

  it("treats owned decoders as 1 included plus extras", () => {
    assert.equal(decodersOwnedCount({ ...dstvCustomer, extraDecoderCount: 0 }), 1);
    assert.equal(decodersOwnedCount(dstvCustomer), 3);
  });

  it("puts 2900 × owned decoders on the first invoice and skips 3500", () => {
    const signup = buildSubscriptionLineItems(dstvCustomer, {}, {
      includeOneTimeDstvFee: true,
    });
    const decoder = signup.find((item) => /decoder charge/i.test(item.name));
    assert.ok(decoder);
    assert.equal(decoder.rate, 2900);
    assert.equal(decoder.quantity, 3);
    assert.equal(signup.some((item) => isExtraDecoderLineItem(item)), false);
    assert.equal(expectedSignupInvoiceTotal(dstvCustomer), 9250 + 2900 * 3);
  });

  it("puts 3500 extra decoder on recurring invoices only", () => {
    const recurring = buildSubscriptionLineItems(dstvCustomer, {}, {
      includeOneTimeDstvFee: false,
    });
    const extra = recurring.find((item) => isExtraDecoderLineItem(item));
    assert.ok(extra);
    assert.equal(extra.rate, 3500);
    assert.equal(extra.quantity, 2);
    assert.equal(extra.name, "Extra decoders");
    assert.equal(
      recurring.some((item) => /decoder charge/i.test(item.name)),
      false
    );
  });

  it("does not bill extra decoder on headend buildings", () => {
    const headend = { ...dstvCustomer, buildingDstvSetup: "headend_coax" };
    assert.equal(extraDecoderCount(headend), 0);
    assert.equal(buildExtraDecoderLineItem(headend), null);
    assert.equal(buildDstvDecoderFeeLineItem(headend), null);
    assert.equal(expectedSignupInvoiceTotal(headend), 9250);
  });

  it("does not put extra decoder on a decoder-only invoice", () => {
    const items = buildSubscriptionLineItems(dstvCustomer, {}, {
      includePackage: false,
      includeOneTimeDstvFee: true,
    });
    assert.equal(items.some((item) => isExtraDecoderLineItem(item)), false);
    assert.equal(items[0].quantity, 3);
    assert.equal(items[0].rate, 2900);
  });

  it("merges Extra decoder by name and deletes leftover extra decoder lines", () => {
    const existing = [
      { line_item_id: "pkg-1", name: "Internet + DSTV" },
      { line_item_id: "dec-1", name: "Extra decoder" },
    ];
    const withoutExtra = mergeRecurringLineItems(existing, [
      { name: "Internet + DSTV", rate: 9250, quantity: 1 },
    ]);
    assert.equal(withoutExtra[1].line_item_id, "dec-1");
    assert.equal(withoutExtra[1].delete, true);

    const withExtra = mergeRecurringLineItems(
      [{ line_item_id: "pkg-1", name: "Internet + DSTV" }],
      [
        { name: "Internet + DSTV", rate: 9250, quantity: 1 },
        { name: "Extra decoder", rate: 3500, quantity: 1 },
      ]
    );
    assert.equal(withExtra[1].name, "Extra decoder");
    assert.equal(withExtra[1].line_item_id, undefined);
  });
});
