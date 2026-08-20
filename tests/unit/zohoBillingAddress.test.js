const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  buildZohoBillingAddress,
  splitStreetLines,
  ZOHO_BILLING_FIELD_MAX,
} = require("../../api/utils/zohoBillingAddress");

describe("buildZohoBillingAddress Zoho field limits", () => {
  it("returns null when no address fields are set", () => {
    assert.equal(buildZohoBillingAddress({}), null);
    assert.equal(buildZohoBillingAddress(null), null);
  });

  it("passes through a short street and defaults country to Kenya", () => {
    const address = buildZohoBillingAddress({
      billingAddress: "Kenyatta Ave",
      billingCity: "Nairobi",
    });
    assert.equal(address.address, "Kenyatta Ave");
    assert.equal(address.city, "Nairobi");
    assert.equal(address.country, "Kenya");
    assert.ok(address.address.length <= ZOHO_BILLING_FIELD_MAX.address);
  });

  it("overflows a street longer than 100 chars onto street2", () => {
    const longStreet =
      "Plot 12, Along Mombasa Road next to the former drive-in cinema opposite the new shopping complex wing B";
    assert.ok(longStreet.length > 100);
    const address = buildZohoBillingAddress({
      billingAddress: longStreet,
      billingCity: "Nairobi",
    });
    assert.ok(address.address.length <= 100);
    assert.ok(address.street2.length > 0);
    assert.ok(address.street2.length <= 100);
    assert.ok(
      `${address.address} ${address.street2}`.includes("Plot 12")
    );
  });

  it("prepends overflow onto an existing street2 without exceeding 100", () => {
    const longStreet = "A".repeat(120);
    const address = buildZohoBillingAddress({
      billing_address: longStreet,
      billing_street2: "P.O. Box 12345",
    });
    assert.equal(address.address, "A".repeat(100));
    assert.ok(address.street2.startsWith("A".repeat(20)));
    assert.ok(address.street2.includes("P.O. Box 12345") || address.street2.length === 100);
    assert.ok(address.street2.length <= 100);
  });

  it("clamps city, state, and country to 50 characters", () => {
    const address = buildZohoBillingAddress({
      billingAddress: "Street",
      billingCity: "C".repeat(80),
      billingState: "S".repeat(80),
      billingCountry: "N".repeat(80),
    });
    assert.equal(address.city.length, 50);
    assert.equal(address.state.length, 50);
    assert.equal(address.country.length, 50);
  });
});

describe("splitStreetLines", () => {
  it("splits on the last space before the 100-char cap", () => {
    const words = Array.from({ length: 20 }, (_, i) => `Word${i}`).join(" ");
    assert.ok(words.length > 100);
    const { address, street2 } = splitStreetLines(words, "");
    assert.ok(address.length <= 100);
    assert.ok(!address.endsWith("Wor"));
    assert.ok(street2.length > 0);
  });
});
