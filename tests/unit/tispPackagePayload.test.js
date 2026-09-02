/**
 * TISP SetPackageDetails payload: catalog labels matching SetClientDetails.Package.
 */
const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  buildTispSetPackagePayload,
  stringifyTispPackagePayload,
  isTispPackageMissingError,
  extractTispDuplicateRecordId,
  syncProductToTisp,
  buildTispPackageLabel,
  pickTispRouterPopName,
} = require("../../api/controllers/tisp.controller");

const BASE_PACKAGE = {
  packageLabel: "BASIC - INTERNET ONLY",
  mbps: 100,
  popName: "Enaki",
  ipSetup: "STATIC",
  price: 4500,
};

describe("TISP SetPackageDetails payload", () => {
  it("sends INSERT with TISP field names and matching speeds", () => {
    const payload = buildTispSetPackagePayload(
      {
        planName: "Basic Plus",
        categoryName: "Internet + Apartonet Channels",
        packageLabel: "BASIC PLUS - INTERNET + APARTONET CHANNELS",
        mbps: 150,
        extraBandwidth: 50,
        price: 4500.9,
        popName: "Enaki",
        ipSetup: "STATIC",
      },
      "INSERT"
    );
    assert.equal(payload.TransactionType, "INSERT");
    assert.equal(
      payload.PackageDescription,
      "BASIC PLUS - INTERNET + APARTONET CHANNELS"
    );
    assert.equal(payload.NewPackageDescription, "");
    assert.equal(payload.PackageType, "IP");
    assert.equal(payload.Router, "ENAKI");
    assert.equal(payload.UploadSpeed, "200");
    assert.equal(payload.DownloadSpeed, "200");
    assert.equal(payload.Cost, "4501");
    assert.equal(payload.ShortCode, "000000");
    assert.equal(payload.PackageIPPool, "");
    assert.equal(payload.Package, undefined);
    assert.equal(payload.Price, undefined);
    assert.equal(payload.Bandwidth, undefined);
    assert.equal(payload.Id, undefined);
  });

  it("sets PackageType PPPOE when the building/POP is PPOE", () => {
    const payload = buildTispSetPackagePayload(
      { ...BASE_PACKAGE, ipSetup: "PPOE" },
      "INSERT"
    );
    assert.equal(payload.PackageType, "PPPOE");
    assert.equal(payload.Router, "ENAKI");
    const wire = stringifyTispPackagePayload(payload);
    assert.match(wire, /"PackageType":"PPPOE"/);
    assert.match(wire, /"NewPackageDescription":"", "Router":"ENAKI"/);
  });

  it("sets PackageType IP when the building/POP is STATIC", () => {
    const payload = buildTispSetPackagePayload(BASE_PACKAGE, "INSERT");
    assert.equal(payload.PackageType, "IP");
  });

  it("sends Router as POP name, never building name", () => {
    const payload = buildTispSetPackagePayload(
      {
        ...BASE_PACKAGE,
        popName: "Enaki",
        buildingName: "Enaki Towers",
      },
      "INSERT"
    );
    assert.equal(payload.Router, "ENAKI");
  });

  it("maps Brookside Terraces (building) to Azalea POP, not the building name", () => {
    const pops = [
      { name: "Azalea" },
      { name: "Enaki" },
      { name: "Colosseum" },
      { name: "Skynest" },
    ];
    const buildings = [
      { name: "Azalea Heights", popName: "Azalea" },
      { name: "Brookside Terraces", popName: "Azalea" },
      { name: "Enaki", popName: "Enaki" },
    ];
    assert.equal(
      pickTispRouterPopName("Brookside Terraces", { pops, buildings }),
      "Azalea"
    );
    assert.equal(
      pickTispRouterPopName("AZALEA HEIGHTS", { pops, buildings }),
      "Azalea"
    );
    assert.equal(
      pickTispRouterPopName("Enaki", { pops, buildings }),
      "Enaki"
    );
  });

  it("sets both speeds to base Mbps when extra bandwidth is absent", () => {
    const payload = buildTispSetPackagePayload(
      { ...BASE_PACKAGE, mbps: 50, extraBandwidth: undefined },
      "INSERT"
    );
    assert.equal(payload.UploadSpeed, "50");
    assert.equal(payload.DownloadSpeed, "50");
  });

  it("wire JSON keeps TISP field order and comma-space separators", () => {
    const payload = buildTispSetPackagePayload(BASE_PACKAGE, "INSERT");
    const wire = stringifyTispPackagePayload(payload);
    assert.equal(
      wire,
      '{"TransactionType":"INSERT", "PackageType":"IP", "PackageDescription":"BASIC - INTERNET ONLY", "NewPackageDescription":"", "Router":"ENAKI", "UploadSpeed":"100", "DownloadSpeed":"100", "Cost":"4500", "PackageIPPool":"", "ShortCode":"000000"}'
    );
  });

  it("puts Id first on UPDATE and keeps NewPackageDescription empty unless renaming", () => {
    const payload = buildTispSetPackagePayload(
      {
        ...BASE_PACKAGE,
        packageLabel: "PREMIUM - INTERNET ONLY",
        mbps: 250,
        tispClientId: "61754fdd-ace2-4c27-b3a0-a17f091dda1e",
      },
      "UPDATE"
    );
    assert.equal(payload.Id, "61754fdd-ace2-4c27-b3a0-a17f091dda1e");
    assert.equal(payload.NewPackageDescription, "");
    const wire = stringifyTispPackagePayload(payload);
    assert.match(wire, /^\{"Id":"61754fdd-ace2-4c27-b3a0-a17f091dda1e"/);
    assert.match(wire, /"TransactionType":"UPDATE", "PackageType"/);
    assert.match(wire, /"PackageDescription":"PREMIUM - INTERNET ONLY"/);
    assert.match(wire, /"NewPackageDescription":""/);
    assert.match(wire, /"UploadSpeed":"250"/);
    assert.match(wire, /"DownloadSpeed":"250"/);
    assert.match(wire, /"ShortCode":"000000"/);
  });

  it("sets NewPackageDescription only when renaming on UPDATE", () => {
    const payload = buildTispSetPackagePayload(
      {
        ...BASE_PACKAGE,
        newPackageDescription: "PREMIUM PLUS - INTERNET ONLY",
      },
      "UPDATE"
    );
    assert.equal(payload.PackageDescription, "BASIC - INTERNET ONLY");
    assert.equal(payload.NewPackageDescription, "PREMIUM PLUS - INTERNET ONLY");
  });

  it("keeps unused optional fields in the body as empty strings", () => {
    const payload = buildTispSetPackagePayload(BASE_PACKAGE, "INSERT");
    assert.equal(payload.NewPackageDescription, "");
    assert.equal(payload.PackageIPPool, "");
    const wire = stringifyTispPackagePayload(payload);
    assert.match(wire, /"NewPackageDescription":""/);
    assert.match(wire, /"PackageIPPool":""/);
  });

  it("rejects a package payload with no bandwidth", () => {
    assert.throws(
      () =>
        buildTispSetPackagePayload({
          packageLabel: "BASIC - INTERNET ONLY",
          popName: "Enaki",
          ipSetup: "STATIC",
        }),
      /UploadSpeed and DownloadSpeed are required/
    );
  });

  it("rejects when PackageType cannot be resolved from the building", () => {
    assert.throws(
      () =>
        buildTispSetPackagePayload({
          packageLabel: "BASIC - INTERNET ONLY",
          mbps: 50,
          popName: "Enaki",
        }),
      /Building IP setup is required/
    );
  });

  it("rejects when Router POP name is missing", () => {
    assert.throws(
      () =>
        buildTispSetPackagePayload({
          packageLabel: "BASIC - INTERNET ONLY",
          mbps: 50,
          ipSetup: "STATIC",
        }),
      /POP name is required/
    );
  });

  it("rejects labels that would not match SetClientDetails Package", () => {
    assert.throws(
      () =>
        buildTispSetPackagePayload({
          packageLabel: "BASIC PACKAGE 30MBPS",
          mbps: 50,
          popName: "Enaki",
          ipSetup: "STATIC",
        }),
      /Invalid TISP Package format/
    );
  });
});

describe("TISP package missing / duplicate helpers", () => {
  it("detects Package Missing from SetClientDetails", () => {
    assert.equal(isTispPackageMissingError("Package Missing."), true);
    assert.equal(isTispPackageMissingError("Package not found"), true);
    assert.equal(isTispPackageMissingError("Account not found"), false);
  });

  it("extracts a UUID from any duplicate-entry body", () => {
    assert.equal(
      extractTispDuplicateRecordId(
        "Duplicate entry '61754fdd-ace2-4c27-b3a0-a17f091dda1e' for key 'package.PRIMARY'"
      ),
      "61754fdd-ace2-4c27-b3a0-a17f091dda1e"
    );
  });
});

describe("syncProductToTisp skips DSTV-only", () => {
  it("does not call TISP for dstv_only products", async () => {
    const result = await syncProductToTisp({
      categoryCode: "dstv_only",
      planName: "DSTV Only",
      categoryName: "DSTV Only",
      mbps: 0,
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "dstv_only");
  });

  it("builds the same label SetClientDetails uses", () => {
    assert.equal(
      buildTispPackageLabel({
        planName: "Premium Plus",
        categoryName: "Internet + DSTV Channels + Apartonet Channels",
      }),
      "PREMIUM PLUS - INTERNET + DSTV CHANNELS + APARTONET CHANNELS"
    );
  });
});
