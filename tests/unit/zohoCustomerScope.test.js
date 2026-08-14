const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  zohoContactMatchesDashboardCustomer,
} = require("../../api/utils/zohoCustomerScope");
const {
  resolveAdvancePaymentCoverage,
} = require("../../api/utils/zohoInvoiceLineItems");

describe("zohoContactMatchesDashboardCustomer after B2B → C2B", () => {
  const c2bCustomer = {
    customerType: "C2B",
    customerNumber: "CL-A10",
  };

  it("rejects a leftover agency contact even when the stored id matches", () => {
    const agencyContact = {
      contact_id: "agency-99",
      company_name: "City Agency",
      contact_name: "City Agency",
    };
    assert.equal(
      zohoContactMatchesDashboardCustomer(
        agencyContact,
        c2bCustomer,
        "agency-99"
      ),
      false
    );
  });

  it("accepts a personal C2B contact whose company_name is the customer number", () => {
    const personal = {
      contact_id: "c2b-1",
      company_name: "CL-A10",
      contact_name: "Jane Tenant",
    };
    assert.equal(
      zohoContactMatchesDashboardCustomer(personal, c2bCustomer, "c2b-1"),
      true
    );
  });

  it("still trusts a stored C2B contact when company_name is empty", () => {
    const legacy = {
      contact_id: "c2b-legacy",
      company_name: "",
      contact_name: "Jane Tenant",
    };
    assert.equal(
      zohoContactMatchesDashboardCustomer(legacy, c2bCustomer, "c2b-legacy"),
      true
    );
  });
});

describe("B2B → C2B conversion invoice coverage", () => {
  it("skips the one-time DSTV decoder fee on type conversion", () => {
    const coverage = resolveAdvancePaymentCoverage(
      { hasDstv: true, decoderFeeRequired: true, decoderFeeAmount: 2900 },
      { skipDecoderFee: true }
    );
    assert.equal(coverage.includePackage, true);
    assert.equal(coverage.includeDecoder, false);
  });
});
