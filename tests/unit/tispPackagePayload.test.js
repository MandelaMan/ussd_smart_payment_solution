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
} = require("../../api/controllers/tisp.controller");

describe("TISP SetPackageDetails payload", () => {
  it("sends INSERT with matching UploadSpeed and DownloadSpeed", () => {
    const payload = buildTispSetPackagePayload(
      {
        planName: "Basic Plus",
        categoryName: "Internet + Apartonet Channels",
        packageLabel: "BASIC PLUS - INTERNET + APARTONET CHANNELS",
        mbps: 150,
        extraBandwidth: 50,
        price: 4500.9,
      },
      "INSERT"
    );
    assert.equal(payload.TransactionType, "INSERT");
    assert.equal(payload.Package, "BASIC PLUS - INTERNET + APARTONET CHANNELS");
    assert.equal(payload.UploadSpeed, "200");
    assert.equal(payload.DownloadSpeed, "200");
    assert.equal(payload.Bandwidth, "200");
    assert.equal(payload.Router, "");
    assert.equal(payload.PackageType, "");
    assert.equal(payload.Price, "4501");
    assert.equal(payload.PackageIPPool, "");
    assert.equal(payload.Id, undefined);
  });

  it("sets PackageType PPPOE when the building/POP is PPOE", () => {
    const payload = buildTispSetPackagePayload(
      {
        packageLabel: "BASIC - INTERNET ONLY",
        mbps: 100,
        popName: "Enaki",
        ipSetup: "PPOE",
      },
      "INSERT"
    );
    assert.equal(payload.PackageType, "PPPOE");
    assert.equal(payload.Router, "ENAKI");
    const wire = stringifyTispPackagePayload(payload);
    assert.match(wire, /"Router":"ENAKI", "PackageType":"PPPOE"/);
  });

  it("sets PackageType IP when the building/POP is STATIC", () => {
    const payload = buildTispSetPackagePayload(
      {
        packageLabel: "BASIC - INTERNET ONLY",
        mbps: 100,
        popName: "Enaki",
        ipSetup: "STATIC",
      },
      "INSERT"
    );
    assert.equal(payload.PackageType, "IP");
  });

  it("sends Router as POP name, never building name", () => {
    const payload = buildTispSetPackagePayload(
      {
        packageLabel: "BASIC - INTERNET ONLY",
        mbps: 100,
        popName: "Enaki",
        buildingName: "Enaki Towers",
      },
      "INSERT"
    );
    assert.equal(payload.Router, "ENAKI");
  });

  it("sets both speeds to base Mbps when extra bandwidth is absent", () => {
    const payload = buildTispSetPackagePayload(
      {
        packageLabel: "BASIC - INTERNET ONLY",
        mbps: 50,
      },
      "INSERT"
    );
    assert.equal(payload.UploadSpeed, "50");
    assert.equal(payload.DownloadSpeed, "50");
  });

  it("wire JSON keeps field order and comma-space separators", () => {
    const payload = buildTispSetPackagePayload(
      {
        packageLabel: "BASIC - INTERNET ONLY",
        mbps: 100,
        extraBandwidth: 0,
        price: 0,
      },
      "INSERT"
    );
    const wire = stringifyTispPackagePayload(payload);
    assert.equal(
      wire,
      '{"TransactionType":"INSERT", "Package":"BASIC - INTERNET ONLY", "Router":"", "PackageType":"", "UploadSpeed":"100", "DownloadSpeed":"100", "Bandwidth":"100", "Price":"", "PackageIPPool":""}'
    );
  });

  it("puts Id first on UPDATE when TISP returned a UUID", () => {
    const payload = buildTispSetPackagePayload(
      {
        packageLabel: "PREMIUM - INTERNET ONLY",
        mbps: 250,
        price: 0,
        tispClientId: "61754fdd-ace2-4c27-b3a0-a17f091dda1e",
      },
      "UPDATE"
    );
    assert.equal(payload.Id, "61754fdd-ace2-4c27-b3a0-a17f091dda1e");
    const wire = stringifyTispPackagePayload(payload);
    assert.match(wire, /^\{"Id":"61754fdd-ace2-4c27-b3a0-a17f091dda1e"/);
    assert.match(wire, /"TransactionType":"UPDATE", "Package"/);
    assert.match(wire, /"UploadSpeed":"250"/);
    assert.match(wire, /"DownloadSpeed":"250"/);
    assert.match(wire, /"PackageIPPool":""/);
  });

  it("keeps unused optional fields in the body as empty strings", () => {
    const payload = buildTispSetPackagePayload(
      { packageLabel: "BASIC - INTERNET ONLY", mbps: 50 },
      "INSERT"
    );
    assert.equal(payload.Price, "");
    assert.equal(payload.PackageIPPool, "");
    const wire = stringifyTispPackagePayload(payload);
    assert.match(wire, /"PackageIPPool":""/);
  });

  it("rejects a package payload with no bandwidth", () => {
    assert.throws(
      () => buildTispSetPackagePayload({ packageLabel: "BASIC - INTERNET ONLY" }),
      /UploadSpeed and DownloadSpeed are required/
    );
  });

  it("rejects labels that would not match SetClientDetails Package", () => {
    assert.throws(
      () => buildTispSetPackagePayload({ packageLabel: "BASIC PACKAGE 30MBPS", mbps: 50 }),
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
