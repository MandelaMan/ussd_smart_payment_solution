const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  zohoContactMatchesDashboardCustomer,
  invoicesPredateCustomer,
  zohoContactLooksReusedByFormerTenant,
  filterInvoicesForCurrentTenant,
  isZohoContactOlderThanCustomer,
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

describe("former-tenant Zoho reuse detection", () => {
  const tz = "Africa/Nairobi";
  const customer = {
    customerNumber: "ET-C303",
    createdAt: "2026-10-01 14:30:00",
  };

  it("does not treat a same-day date-only signup invoice as former-tenant", () => {
    const invoices = [{ date: "2026-10-01", invoice_number: "INV-1" }];
    assert.equal(invoicesPredateCustomer(invoices, customer, tz), false);
    assert.equal(
      zohoContactLooksReusedByFormerTenant(null, customer, invoices, tz),
      false
    );
    const shown = filterInvoicesForCurrentTenant(invoices, customer, {
      isChangeover: true,
      timeZone: tz,
    });
    assert.equal(shown.length, 1);
  });

  it("still hides invoices from an earlier calendar day on a reused contact", () => {
    const invoices = [
      { date: "2026-09-15", invoice_number: "INV-OLD" },
      { date: "2026-10-01", invoice_number: "INV-NEW" },
    ];
    const oldContact = {
      contact_id: "zoho-eva",
      created_time: "2025-01-10T09:00:00+03:00",
    };
    assert.equal(invoicesPredateCustomer(invoices, customer, tz), true);
    assert.equal(
      zohoContactLooksReusedByFormerTenant(oldContact, customer, invoices, tz),
      true
    );
    const shown = filterInvoicesForCurrentTenant(invoices, customer, {
      isChangeover: true,
      timeZone: tz,
    });
    assert.equal(shown.length, 1);
    assert.equal(shown[0].invoice_number, "INV-NEW");
  });

  it("does not flag a fresh Zoho contact even when the apartment had a prior tenant", () => {
    const invoices = [{ date: "2026-10-01", invoice_number: "INV-1" }];
    const freshContact = {
      contact_id: "zoho-carolyne",
      created_time: "2026-10-01T14:31:00+03:00",
    };
    assert.equal(
      isZohoContactOlderThanCustomer(freshContact, customer),
      false
    );
    assert.equal(
      zohoContactLooksReusedByFormerTenant(
        freshContact,
        customer,
        invoices,
        tz
      ),
      false
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
