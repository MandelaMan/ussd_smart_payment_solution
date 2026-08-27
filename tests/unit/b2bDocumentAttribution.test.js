const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  attributeDocumentAmount,
  isConsolidatedAgencyDocument,
  unitWeight,
} = require("../../api/utils/b2bDocumentAttribution");

function peer(id, number, price, discount = 14.88) {
  return {
    id,
    customer_number: number,
    customer_type: "B2B",
    agency_id: 4,
    package_price: price,
    discount_percent: discount,
  };
}

describe("consolidated B2B document split", () => {
  const peers = [
    peer(1, "SKYB-1003", 6500),
    peer(2, "SKYB-414", 6500),
    peer(3, "SKYB-200", 6500),
  ];

  it("treats a large agency invoice as consolidated", () => {
    assert.equal(isConsolidatedAgencyDocument(532440, peers), true);
    assert.equal(isConsolidatedAgencyDocument(6500, peers), false);
  });

  it("splits a consolidated invoice across managed houses, not onto one house", () => {
    const shares = attributeDocumentAmount({
      amount: 532440,
      keepCustomer: peers[1],
      agencyPeers: peers,
    });
    const sum = shares.reduce((s, x) => s + x.amount, 0);
    assert.equal(shares.length, 3);
    assert.equal(Math.round(sum * 100) / 100, 532440);
    const keepShare = shares.find((s) => s.customerId === 2);
    assert.equal(keepShare.amount < 200000, true);
  });

  it("keeps a normal C2B invoice on that customer", () => {
    const shares = attributeDocumentAmount({
      amount: 2500,
      keepCustomer: {
        id: 10,
        customer_number: "ET-H204",
        customer_type: "C2B",
        agency_id: null,
        package_price: 2500,
      },
      agencyPeers: peers,
    });
    assert.equal(shares.length, 1);
    assert.equal(shares[0].customerId, 10);
    assert.equal(shares[0].amount, 2500);
  });
});

describe("unitWeight", () => {
  it("applies agency discount for B2B", () => {
    const w = unitWeight({ package_price: 6500, discount_percent: 14.88 });
    assert.equal(w < 6500, true);
    assert.equal(w > 5000, true);
  });
});
