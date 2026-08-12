const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  buildCustomerNumber,
  liveCustomerNumber,
  archiveCancelledCustomerNumber,
  isValidPaybillAccountRef,
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

  it("uppercases apartment segment", () => {
    assert.equal(buildCustomerNumber(singleBuilding, "C2B", "h302"), "ET-H302");
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
