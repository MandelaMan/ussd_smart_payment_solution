const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  uniqueZohoPaymentRevenue,
  zohoDistinctPaymentsSql,
} = require("../../api/utils/collectedRevenueSql");

describe("uniqueZohoPaymentRevenue", () => {
  it("counts an agency remittance once even when copied onto many customers", () => {
    const rows = Array.from({ length: 73 }, (_, index) => ({
      payment_id: "6631333000004272003",
      customer_id: 200 + index,
      amount: 532440,
    }));
    rows.push({ payment_id: "mobile-1", customer_id: 1, amount: 4500 });
    assert.equal(uniqueZohoPaymentRevenue(rows), 536940);
  });

  it("keeps the largest amount if copies disagree", () => {
    assert.equal(
      uniqueZohoPaymentRevenue([
        { payment_id: "p1", amount: 100 },
        { payment_id: "p1", amount: 250 },
        { payment_id: "p2", amount: 50 },
      ]),
      300
    );
  });
});

describe("zohoDistinctPaymentsSql", () => {
  it("groups by payment_id so dashboard sums cannot multiply per customer", () => {
    const sql = zohoDistinctPaymentsSql("WHERE payment_date >= ? AND payment_date < ?");
    assert.match(sql, /GROUP BY payment_id/);
    assert.match(sql, /MAX\(amount\)/);
  });
});
