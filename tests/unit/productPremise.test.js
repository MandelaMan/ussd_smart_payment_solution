const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  parseRequiredPremiseType,
  productPremiseType,
  assertProductMatchesPremise,
  assertProductAssignable,
} = require("../../api/utils/productPremise");

describe("package premise type", () => {
  it("requires apartment or shop on create", () => {
    assert.equal(parseRequiredPremiseType("apartment"), "apartment");
    assert.equal(parseRequiredPremiseType("SHOP"), "shop");
    assert.throws(
      () => parseRequiredPremiseType(""),
      /apartment or a shop/i
    );
    assert.throws(
      () => parseRequiredPremiseType("office"),
      /apartment or a shop/i
    );
  });

  it("reads camelCase or snake_case product fields", () => {
    assert.equal(productPremiseType({ premise_type: "shop" }), "shop");
    assert.equal(productPremiseType({ premiseType: "apartment" }), "apartment");
    assert.equal(productPremiseType({}), "apartment");
  });

  it("rejects assigning a shop package to an apartment customer", () => {
    assert.throws(
      () => assertProductMatchesPremise({ premiseType: "shop" }, "apartment"),
      /for shops/i
    );
    assert.doesNotThrow(() =>
      assertProductMatchesPremise({ premise_type: "shop" }, "shop")
    );
  });

  it("lets a shop customer stay on an apartment package during transition", () => {
    assert.doesNotThrow(() =>
      assertProductAssignable(
        { premiseType: "apartment" },
        { customerPremise: "shop", currentProductPremise: "apartment" }
      )
    );
    assert.doesNotThrow(() =>
      assertProductAssignable(
        { premiseType: "shop" },
        { customerPremise: "shop", currentProductPremise: "apartment" }
      )
    );
    assert.throws(
      () =>
        assertProductAssignable(
          { premiseType: "shop" },
          { customerPremise: "apartment", currentProductPremise: "apartment" }
        ),
      /for shops/i
    );
  });
});
