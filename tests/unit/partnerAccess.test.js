const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  resolvePartnerAccess,
  partnerCanViewCustomer,
  runWithPartnerCustomerScope,
  dstvCustomerSql,
  dstvProductSql,
  currentPartnerCustomerScope,
} = require("../../api/rbac/partnerAccess");

describe("partner access types", () => {
  it("admins are never treated as scoped partners", () => {
    const access = resolvePartnerAccess({
      role: "admin",
      permissions: ["partner.dstv", "dashboard.partner"],
      groups: [{ slug: "partner-dstv" }],
    });
    assert.equal(access.isPartner, false);
    assert.equal(access.customerScope, "all");
    assert.equal(access.type, null);
  });

  it("DSTV partner is limited to DSTV customers", () => {
    const access = resolvePartnerAccess({
      role: "user",
      permissions: ["dashboard.partner", "partner.dstv", "customers.view"],
      groups: [{ slug: "partner-dstv" }],
    });
    assert.equal(access.isPartner, true);
    assert.equal(access.type, "dstv");
    assert.equal(access.customerScope, "dstv");
    assert.equal(partnerCanViewCustomer(access, { hasDstv: true }), true);
    assert.equal(partnerCanViewCustomer(access, { hasDstv: false }), false);
  });

  it("Internet and Investor partners see all customers", () => {
    const internet = resolvePartnerAccess({
      role: "user",
      permissions: ["dashboard.partner", "partner.internet"],
      groups: [{ slug: "customer-relations" }],
    });
    const investor = resolvePartnerAccess({
      role: "user",
      permissions: ["dashboard.partner", "partner.investor", "analytics.view"],
      groups: [{ slug: "partner-investor" }],
    });
    assert.equal(internet.type, "internet");
    assert.equal(internet.customerScope, "all");
    assert.equal(investor.type, "investor");
    assert.equal(investor.customerScope, "all");
    assert.equal(partnerCanViewCustomer(internet, { hasDstv: false }), true);
    assert.equal(partnerCanViewCustomer(investor, { hasDstv: false }), true);
  });

  it("DSTV SQL fragments are empty unless scope is active", () => {
    assert.equal(dstvCustomerSql("c"), "");
    assert.equal(dstvProductSql("p"), "");
    runWithPartnerCustomerScope("dstv", () => {
      assert.equal(currentPartnerCustomerScope(), "dstv");
      assert.ok(dstvCustomerSql("c").includes("has_dstv = 1"));
      assert.ok(dstvProductSql("p").includes("p.has_dstv = 1"));
    });
    assert.equal(currentPartnerCustomerScope(), "all");
  });
});
