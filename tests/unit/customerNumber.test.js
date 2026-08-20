const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  buildCustomerNumber,
  alternateTypeCustomerNumber,
  liveCustomerNumber,
  archiveCancelledCustomerNumber,
  compactCustomerNumber,
  normalizePaybillAccountRef,
  pickUniquePaybillCustomer,
  isValidPaybillAccountRef,
  normalizePremiseType,
  shopLocationCode,
} = require("../../api/utils/customerNumber");

describe("customer numbering (signup / move / convert / cancel)", () => {
  const singleBuilding = {
    c2b_code: "ET",
    b2b_code: "ETB",
    building_code: "",
  };
  const multiBuilding = {
    c2bCode: "AZE",
    b2bCode: "AZEB",
    buildingCode: "TGA",
  };

  it("builds POP-APT for single-building C2B", () => {
    assert.equal(buildCustomerNumber(singleBuilding, "C2B", "401A"), "ET-401A");
  });

  it("builds POP-APT for single-building B2B", () => {
    assert.equal(buildCustomerNumber(singleBuilding, "B2B", "401A"), "ETB-401A");
  });

  it("builds POP-BUILDING-APT for multi-building C2B", () => {
    assert.equal(
      buildCustomerNumber(multiBuilding, "C2B", "401A"),
      "AZE-TGA-401A"
    );
  });

  it("builds POP-BUILDING-APT for multi-building B2B convert", () => {
    assert.equal(
      buildCustomerNumber(multiBuilding, "B2B", "401A"),
      "AZEB-TGA-401A"
    );
  });

  it("alternate type number is CL-DLG1 ↔ CLB-DLG1", () => {
    const colo = { c2b_code: "CL", b2b_code: "CLB", building_code: "" };
    assert.equal(alternateTypeCustomerNumber(colo, "C2B", "DLG1"), "CLB-DLG1");
    assert.equal(alternateTypeCustomerNumber(colo, "B2B", "DLG1"), "CL-DLG1");
  });

  it("alternate type number keeps the building segment", () => {
    assert.equal(
      alternateTypeCustomerNumber(multiBuilding, "C2B", "401A"),
      "AZEB-TGA-401A"
    );
    assert.equal(
      alternateTypeCustomerNumber(multiBuilding, "B2B", "401A"),
      "AZE-TGA-401A"
    );
  });

  it("uppercases apartment segment", () => {
    assert.equal(buildCustomerNumber(singleBuilding, "C2B", "h302"), "ET-H302");
  });

  it("builds POP-SHP-LOCATION for a shop", () => {
    assert.equal(
      buildCustomerNumber(singleBuilding, "C2B", "s 18", "shop"),
      "ET-SHP-S18"
    );
    assert.equal(
      buildCustomerNumber(multiBuilding, "C2B", "s18", "shop"),
      "AZE-TGA-SHP-S18"
    );
    assert.equal(
      buildCustomerNumber(multiBuilding, "B2B", "s18", "shop"),
      "AZEB-TGA-SHP-S18"
    );
  });

  it("strips spaces from shop location in the customer number", () => {
    assert.equal(shopLocationCode("s 18"), "S18");
    assert.equal(shopLocationCode("Ground floor, shop 3"), "GROUNDFLOORSHOP3");
    assert.equal(
      buildCustomerNumber(multiBuilding, "C2B", "Ground floor shop 3", "shop"),
      "AZE-TGA-SHP-GROUNDFLOORSHOP3"
    );
  });

  it("normalizes premise type", () => {
    assert.equal(normalizePremiseType("shop"), "shop");
    assert.equal(normalizePremiseType("SHOP"), "shop");
    assert.equal(normalizePremiseType("apartment"), "apartment");
    assert.equal(normalizePremiseType(""), "apartment");
  });

  it("alternate type number keeps the SHP segment for shops", () => {
    assert.equal(
      alternateTypeCustomerNumber(multiBuilding, "C2B", "S18", "shop"),
      "AZEB-TGA-SHP-S18"
    );
    assert.equal(
      alternateTypeCustomerNumber(multiBuilding, "B2B", "S18", "shop"),
      "AZE-TGA-SHP-S18"
    );
  });

  it("strips CXL archive suffix to live number", () => {
    assert.equal(liveCustomerNumber("ET-H302-CXL-237"), "ET-H302");
    assert.equal(liveCustomerNumber("aze-tga-401a-cxl-12"), "AZE-TGA-401A");
  });

  it("archives cancelled number as {number}-CXL-{id}", () => {
    assert.equal(
      archiveCancelledCustomerNumber("ET-H302", 237),
      "ET-H302-CXL-237"
    );
  });

  it("keeps archived form within VARCHAR(50)", () => {
    const long = "ABCDEFGHIJ-KLMNOPQRST-UVWXYZ1234567890";
    const archived = archiveCancelledCustomerNumber(long, 999999);
    assert.ok(archived.length <= 50);
    assert.match(archived, /-CXL-999999$/);
  });
});

describe("paybill BillRefNumber validation", () => {
  it("accepts real POP account refs across buildings", () => {
    for (const ref of [
      "ET-401A",
      "ETB-401A",
      "AZE-TGA-401A",
      "AZEB-TGA-401A",
      "CL-A10",
      "CLB-A10",
      "AZE-TGA-SHP-S18",
      "ET-SHP-S18",
    ]) {
      assert.equal(isValidPaybillAccountRef(ref), true, ref);
    }
  });

  it("accepts common customer typing mistakes", () => {
    for (const ref of [
      "ET T506",
      "et T506",
      "et-t506",
      "t506",
      "ETT506",
      "ET_T506",
    ]) {
      assert.equal(isValidPaybillAccountRef(ref), true, ref);
    }
  });

  it("rejects archived cancel numbers and free text", () => {
    for (const ref of [
      "",
      "Starlynx Utility",
      "ET-H302-CXL-12",
      "ET",
      "just-text-here-too-long-segment-name-xxxxxxxx",
      "123",
    ]) {
      assert.equal(isValidPaybillAccountRef(ref), false, ref);
    }
  });
});

describe("paybill customer recognition", () => {
  const etT506 = {
    id: 1,
    customerNumber: "ET-T506",
    apartmentNumber: "T506",
    phone: "0712345678",
    status: "active",
  };
  const azeT506 = {
    id: 2,
    customerNumber: "AZE-TGA-T506",
    apartmentNumber: "T506",
    phone: "0798765432",
    status: "active",
  };

  it("normalizes spaces and case to the canonical hyphen form", () => {
    assert.equal(normalizePaybillAccountRef("et T506"), "ET-T506");
    assert.equal(normalizePaybillAccountRef("ET_T506"), "ET-T506");
    assert.equal(compactCustomerNumber("et T506"), "ETT506");
  });

  it("resolves spacing and case variants to ET-T506", () => {
    for (const ref of ["ET-T506", "ET T506", "et T506", "et-t506", "ETT506"]) {
      const hit = pickUniquePaybillCustomer([etT506, azeT506], ref);
      assert.equal(hit?.customerNumber, "ET-T506", ref);
    }
  });

  it("resolves apartment-only t506 when only one customer matches", () => {
    const hit = pickUniquePaybillCustomer([etT506], "t506");
    assert.equal(hit?.customerNumber, "ET-T506");
  });

  it("does not guess apartment-only t506 when two customers share it", () => {
    assert.equal(pickUniquePaybillCustomer([etT506, azeT506], "t506"), null);
  });

  it("uses the paying phone to disambiguate apartment-only refs", () => {
    const hit = pickUniquePaybillCustomer([etT506, azeT506], "t506", {
      msisdn: "254712345678",
    });
    assert.equal(hit?.customerNumber, "ET-T506");
  });

  it("ignores cancelled and archived customers", () => {
    const cancelled = {
      id: 9,
      customerNumber: "ET-T506-CXL-12",
      apartmentNumber: "T506",
      status: "cancelled",
    };
    const hit = pickUniquePaybillCustomer([cancelled, etT506], "t506");
    assert.equal(hit?.customerNumber, "ET-T506");
  });
});
