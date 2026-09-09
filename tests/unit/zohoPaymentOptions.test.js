const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  parseGatewayNames,
  isPaystackGateway,
  withRequiredPaymentGateways,
  looksLikePaymentGatewayError,
  withoutPaymentOptions,
  invoiceHasPaystackPaymentOption,
} = require("../../api/utils/zohoPaymentOptions");

describe("zohoPaymentOptions", () => {
  it("defaults to paystack and accepts a comma list", () => {
    const prev = process.env.ZOHO_RECURRING_PAYMENT_GATEWAYS;
    delete process.env.ZOHO_RECURRING_PAYMENT_GATEWAYS;
    try {
      assert.deepEqual(parseGatewayNames(""), ["paystack"]);
      assert.deepEqual(parseGatewayNames("paystack, stripe"), [
        "paystack",
        "stripe",
      ]);
    } finally {
      if (prev == null) delete process.env.ZOHO_RECURRING_PAYMENT_GATEWAYS;
      else process.env.ZOHO_RECURRING_PAYMENT_GATEWAYS = prev;
    }
  });

  it("checks Paystack on a new recurring payload", () => {
    const payload = withRequiredPaymentGateways({ customer_id: "c1" });
    assert.deepEqual(payload.payment_options.payment_gateways, [
      { gateway_name: "paystack", configured: true },
    ]);
    assert.equal(payload.customer_id, "c1");
  });

  it("keeps other gateways and forces Paystack configured", () => {
    const payload = withRequiredPaymentGateways(
      {},
      {
        payment_gateways: [
          { gateway_name: "stripe", configured: true },
          { gateway_name: "paystack", configured: false },
        ],
      }
    );
    const names = payload.payment_options.payment_gateways.map(
      (g) => `${g.gateway_name}:${g.configured}`
    );
    assert.ok(names.includes("stripe:true"));
    assert.ok(names.includes("paystack:true"));
  });

  it("detects Zoho gateway validation errors", () => {
    assert.equal(
      looksLikePaymentGatewayError({
        response: { data: { message: "Invalid value passed for gateway_name" } },
      }),
      true
    );
    assert.equal(looksLikePaymentGatewayError({ message: "timeout" }), false);
    assert.equal(
      withoutPaymentOptions({
        recurrence_name: "x",
        payment_options: { payment_gateways: [] },
      }).payment_options,
      undefined
    );
    assert.equal(isPaystackGateway({ gateway_name: "Paystack" }), true);
    assert.equal(
      invoiceHasPaystackPaymentOption({
        payment_options: {
          payment_gateways: [{ gateway_name: "paystack", configured: true }],
        },
      }),
      true
    );
    assert.equal(invoiceHasPaystackPaymentOption({}), false);
  });
});
