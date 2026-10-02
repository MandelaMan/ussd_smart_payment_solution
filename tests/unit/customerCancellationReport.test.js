const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  getReportDefinition,
  isPartnerReport,
  resolveMoveOutReason,
} = require("../../api/services/reportStore");

describe("customer cancellation report", () => {
  it("is a dated customer report available to partners", () => {
    const def = getReportDefinition("customer-cancellation");
    assert.ok(def);
    assert.equal(def.title, "Customer Cancellation Report");
    assert.equal(def.family, "Customer");
    assert.equal(def.dateFilter, true);
    assert.equal(def.available, undefined);
    assert.equal(isPartnerReport("customer-cancellation", "investor"), true);
    assert.equal(isPartnerReport("customer-cancellation", "dstv"), true);
  });

  it("uses the stored cancellation reason as the move-out reason", () => {
    assert.equal(
      resolveMoveOutReason("Moved out", "Reason: switched provider"),
      "Moved out"
    );
  });

  it("reads the move-out reason from older cancellation notes", () => {
    assert.equal(
      resolveMoveOutReason(
        "",
        "Reason: Relocated to another city · ONU collected: 2026-09-01"
      ),
      "Relocated to another city"
    );
    assert.equal(resolveMoveOutReason(null, "   "), "");
    assert.equal(resolveMoveOutReason("", "Customer requested disconnect"), "Customer requested disconnect");
  });
});
