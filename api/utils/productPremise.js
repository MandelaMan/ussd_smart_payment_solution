const { normalizePremiseType } = require("./customerNumber");

function parseRequiredPremiseType(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (raw === "apartment" || raw === "shop") return raw;
  throw new Error("Specify whether this package is for an apartment or a shop");
}

function productPremiseType(product) {
  return normalizePremiseType(product?.premise_type ?? product?.premiseType);
}

function assertProductMatchesPremise(product, premiseType) {
  const expected = normalizePremiseType(premiseType);
  const actual = productPremiseType(product);
  if (actual !== expected) {
    throw new Error(
      actual === "shop"
        ? "This package is for shops. Select a shop package."
        : "This package is for apartments. Select an apartment package."
    );
  }
}

function assertProductAssignable(
  product,
  { customerPremise, currentProductPremise } = {}
) {
  const next = productPremiseType(product);
  const allowed = new Set();
  if (customerPremise != null && customerPremise !== "") {
    allowed.add(normalizePremiseType(customerPremise));
  }
  if (currentProductPremise != null && currentProductPremise !== "") {
    allowed.add(productPremiseType({ premiseType: currentProductPremise }));
  }
  if (!allowed.size) {
    assertProductMatchesPremise(product, customerPremise);
    return;
  }
  if (!allowed.has(next)) {
    throw new Error(
      next === "shop"
        ? "This package is for shops. Select a shop package."
        : "This package is for apartments. Select an apartment package."
    );
  }
}

module.exports = {
  parseRequiredPremiseType,
  productPremiseType,
  assertProductMatchesPremise,
  assertProductAssignable,
};
