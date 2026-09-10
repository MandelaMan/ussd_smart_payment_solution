const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  customerSeriesHint,
  pickZohoTransactionSeries,
  invoiceSeriesPayload,
} = require("../../api/utils/zohoTransactionSeries");

const ASSOCIATED_SERIES = [
  {
    autonumbergenerationgroup_id: "default",
    autonumbergenerationgroup_name: "Default Transaction Series",
    is_default_series: true,
  },
  {
    autonumbergenerationgroup_id: "enaki",
    autonumbergenerationgroup_name: "Enaki Series",
  },
  {
    autonumbergenerationgroup_id: "skynest",
    autonumbergenerationgroup_name: "Skynest Series",
  },
  {
    autonumbergenerationgroup_id: "colosseum",
    autonumbergenerationgroup_name: "Colosseum Series",
  },
  {
    autonumbergenerationgroup_id: "azalea",
    autonumbergenerationgroup_name: "GM Azalea Series",
  },
];

describe("zohoTransactionSeries", () => {
  it("maps POP / building / customer number onto the Zoho series hint", () => {
    assert.equal(customerSeriesHint({ popName: "Enaki" }), "enaki");
    assert.equal(customerSeriesHint({ buildingName: "Skynest Residences" }), "skynest");
    assert.equal(customerSeriesHint({ popName: "Colosseum" }), "colosseum");
    assert.equal(customerSeriesHint({ popName: "Azalea" }), "azalea");
    assert.equal(
      customerSeriesHint({ buildingName: "Brookside Terraces" }),
      "azalea"
    );
    assert.equal(customerSeriesHint({ customerNumber: "AZE-AH-7Z" }), "azalea");
    assert.equal(customerSeriesHint({ customerNumber: "SKY-706" }), "skynest");
    assert.equal(customerSeriesHint({ buildingCode: "ET" }), "enaki");
    assert.equal(customerSeriesHint({ c2bCode: "CL" }), "colosseum");
    assert.equal(customerSeriesHint({}), null);
  });

  it("picks the named series and never Default", () => {
    assert.equal(
      pickZohoTransactionSeries(ASSOCIATED_SERIES, { popName: "Enaki" })
        .autonumbergenerationgroup_id,
      "enaki"
    );
    assert.equal(
      pickZohoTransactionSeries(ASSOCIATED_SERIES, {
        customerNumber: "SKY-706",
      }).autonumbergenerationgroup_name,
      "Skynest Series"
    );
    assert.equal(
      pickZohoTransactionSeries(ASSOCIATED_SERIES, {
        customerNumber: "AZE-AH-7Z",
      }).autonumbergenerationgroup_name,
      "GM Azalea Series"
    );
    assert.equal(
      pickZohoTransactionSeries(ASSOCIATED_SERIES, { popName: "Colosseum" })
        .autonumbergenerationgroup_name,
      "Colosseum Series"
    );
    assert.equal(
      pickZohoTransactionSeries(ASSOCIATED_SERIES, { popName: "Unknown" }),
      null
    );
  });

  it("builds the Zoho create payload with location + series id", () => {
    const series = pickZohoTransactionSeries(ASSOCIATED_SERIES, {
      popName: "Enaki",
    });
    assert.deepEqual(invoiceSeriesPayload("loc-internet", series), {
      location_id: "loc-internet",
      autonumbergenerationgroup_id: "enaki",
    });
    assert.equal(invoiceSeriesPayload("", null), null);
  });
});
