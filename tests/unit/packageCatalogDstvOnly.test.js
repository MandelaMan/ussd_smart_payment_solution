const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  isDstvOnlyCategory,
  isDstvOnlyRecord,
} = require("../../api/services/packageCatalogStore");

describe("DSTV Only catalog detection", () => {
  it("matches category codes and labels", () => {
    assert.equal(isDstvOnlyCategory("dstv_only"), true);
    assert.equal(isDstvOnlyCategory("DSTV Only"), true);
    assert.equal(isDstvOnlyCategory("dstv-only"), true);
    assert.equal(isDstvOnlyCategory("Internet Only"), false);
    assert.equal(
      isDstvOnlyCategory("Internet + DSTV Channels + Apartonet Channels"),
      false
    );
  });

  it("detects customers and products from catalog fields", () => {
    assert.equal(
      isDstvOnlyRecord({ category_code: "dstv_only", product_mbps: 80 }),
      true
    );
    assert.equal(
      isDstvOnlyRecord({ categoryName: "DSTV Only", mbps: 0 }),
      true
    );
    assert.equal(
      isDstvOnlyRecord({ productName: "DSTV Only", hasDstv: true, mbps: 0 }),
      true
    );
    assert.equal(
      isDstvOnlyRecord({
        has_dstv: 1,
        product_mbps: 0,
        extra_bandwidth: 0,
      }),
      true
    );
    assert.equal(
      isDstvOnlyRecord({
        category_code: "internet_dstv_apartonet",
        has_dstv: 1,
        mbps: 80,
      }),
      false
    );
  });
});
