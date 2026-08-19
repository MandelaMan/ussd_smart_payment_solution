const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const { buildingUsesDecoder, resolveDstvSetup } = require("../../api/utils/dstvSetup");
const {
  shouldIncludeDstvOneTimeFee,
  resolveAdvancePaymentCoverage,
  expectedSignupInvoiceTotal,
  buildDstvDecoderFeeLineItem,
} = require("../../api/utils/zohoInvoiceLineItems");

describe("building DSTV setup", () => {
  it("treats missing setup as decoder (legacy default)", () => {
    assert.equal(resolveDstvSetup(null), "decoder");
    assert.equal(buildingUsesDecoder({}), true);
  });

  it("recognizes headend coax on camelCase and snake_case fields", () => {
    assert.equal(buildingUsesDecoder({ dstvSetup: "headend_coax" }), false);
    assert.equal(buildingUsesDecoder({ dstv_setup: "headend_coax" }), false);
    assert.equal(
      buildingUsesDecoder({ buildingDstvSetup: "headend_coax" }),
      false
    );
    assert.equal(
      buildingUsesDecoder({ building_dstv_setup: "headend_coax" }),
      false
    );
  });

  it("recognizes individual decoder buildings", () => {
    assert.equal(buildingUsesDecoder({ dstvSetup: "decoder" }), true);
    assert.equal(buildingUsesDecoder("decoder"), true);
  });
});

describe("DSTV decoder fee is skipped for headend buildings", () => {
  const dstvCustomer = {
    hasDstv: true,
    decoderFeeRequired: true,
    decoderFeeAmount: 2900,
    packagePrice: 9250,
  };

  it("still charges decoder fee for decoder buildings", () => {
    const customer = { ...dstvCustomer, buildingDstvSetup: "decoder" };
    assert.equal(shouldIncludeDstvOneTimeFee(customer), true);
    assert.equal(buildDstvDecoderFeeLineItem(customer)?.rate, 2900);
    const coverage = resolveAdvancePaymentCoverage(customer);
    assert.equal(coverage.includeDecoder, true);
    assert.equal(expectedSignupInvoiceTotal(customer), 9250 + 2900);
  });

  it("does not charge decoder fee for headend coax buildings", () => {
    const customer = { ...dstvCustomer, buildingDstvSetup: "headend_coax" };
    assert.equal(shouldIncludeDstvOneTimeFee(customer), false);
    assert.equal(buildDstvDecoderFeeLineItem(customer), null);
    const coverage = resolveAdvancePaymentCoverage(customer);
    assert.equal(coverage.includeDecoder, false);
    assert.equal(coverage.hasDstv, false);
    assert.equal(expectedSignupInvoiceTotal(customer), 9250);
  });

  it("ignores a leftover decoderFeeRequired flag on headend buildings", () => {
    const customer = {
      hasDstv: true,
      decoderFeeRequired: true,
      decoder_fee_required: 1,
      dstv_setup: "headend_coax",
      packagePrice: 5000,
    };
    assert.equal(shouldIncludeDstvOneTimeFee(customer), false);
    assert.equal(expectedSignupInvoiceTotal(customer), 5000);
  });
});
