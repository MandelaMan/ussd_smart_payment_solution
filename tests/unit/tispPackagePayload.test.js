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
  isTispDuplicatePackageError,
  syncProductToTisp,
  buildTispPackageLabel,
  pickTispRouterPopName,
  buildTispCreateClientPayload,
} = require("../../api/controllers/tisp.controller");

const BASE_PACKAGE = {
  packageLabel: "BASIC - INTERNET ONLY",
  mbps: 100,
  popName: "Enaki",
  ipSetup: "STATIC",
  paymentFrequency: "monthly",
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
      "200_BASIC_PLUS_INT_APT_MONTHLY_4501"
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
    assert.equal(payload.PackageIPPool, "192.168.85.2-192.168.85.254");
    const wire = stringifyTispPackagePayload(payload);
    assert.match(wire, /"PackageType":"PPPOE"/);
    assert.match(wire, /"PackageIPPool":"192.168.85.2-192.168.85.254"/);
  });

  it("sets PackageType IP when the building/POP is STATIC and leaves PackageIPPool blank", () => {
    const payload = buildTispSetPackagePayload(BASE_PACKAGE, "INSERT");
    assert.equal(payload.PackageType, "IP");
    assert.equal(payload.PackageIPPool, "");
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
      { name: "Brookside Terraces" },
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
      '{"TransactionType":"INSERT", "PackageType":"IP", "PackageDescription":"100_BASIC_INT_MONTHLY_4500", "NewPackageDescription":"", "Router":"ENAKI", "UploadSpeed":"100", "DownloadSpeed":"100", "Cost":"4500", "PackageIPPool":"", "ShortCode":"000000"}'
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
    assert.match(wire, /"PackageDescription":"250_PREMIUM_INT_MONTHLY_4500"/);
    assert.match(wire, /"NewPackageDescription":""/);
    assert.match(wire, /"UploadSpeed":"250"/);
    assert.match(wire, /"DownloadSpeed":"250"/);
    assert.match(wire, /"ShortCode":"000000"/);
  });

  it("UPDATE rename keeps the old TISP name and sets NewPackageDescription", () => {
    const payload = buildTispSetPackagePayload(
      {
        packageLabel: "80_BASIC_INT_MONTHLY_21",
        usePackageLabelAsIs: true,
        newPackageDescription: "80_BASIC_INT_MONTHLY_25",
        mbps: 80,
        price: 25,
        paymentFrequency: "monthly",
        popName: "Colosseum",
        ipSetup: "STATIC",
      },
      "UPDATE"
    );
    assert.equal(payload.TransactionType, "UPDATE");
    assert.equal(payload.PackageDescription, "80_BASIC_INT_MONTHLY_21");
    assert.equal(payload.NewPackageDescription, "80_BASIC_INT_MONTHLY_25");
    assert.equal(payload.Cost, "25");
    assert.equal(payload.UploadSpeed, "80");
  });

  it("sets NewPackageDescription only when renaming on UPDATE", () => {
    const payload = buildTispSetPackagePayload(
      {
        ...BASE_PACKAGE,
        newPackageDescription: "PREMIUM PLUS - INTERNET ONLY",
      },
      "UPDATE"
    );
    assert.equal(
      payload.PackageDescription,
      "100_BASIC_INT_MONTHLY_4500"
    );
    assert.equal(
      payload.NewPackageDescription,
      "100_PREMIUM_PLUS_INT_MONTHLY_4500"
    );
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

  it("detects Duplicate Package Exists without a UUID", () => {
    assert.equal(
      isTispDuplicatePackageError("Failed. Duplicate Package Exists."),
      true
    );
    assert.equal(
      extractTispDuplicateRecordId("Failed. Duplicate Package Exists."),
      ""
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

  it("shortens catalog categories to INT / INT_APT / INT_DSTV_APT", () => {
    assert.equal(
      buildTispPackageLabel({
        planName: "Basic",
        categoryName: "Internet Only",
        paymentFrequency: "monthly",
        mbps: 80,
        price: 2,
      }),
      "80_BASIC_INT_MONTHLY_2"
    );
    assert.equal(
      buildTispPackageLabel({
        planName: "Basic Plus",
        categoryName: "Internet + Apartonet Channels",
        paymentFrequency: "quarterly",
        mbps: 150,
        price: 12000,
      }),
      "150_BASIC_PLUS_INT_APT_QUARTERLY_12000"
    );
    assert.equal(
      buildTispPackageLabel({
        planName: "Premium Plus",
        categoryName: "Internet + DSTV Channels + Apartonet Channels",
        paymentFrequency: "yearly",
        mbps: 250,
        price: 45000,
      }),
      "250_PREMIUM_PLUS_INT_DSTV_APT_YEARLY_45000"
    );
  });

  it("builds the same label SetClientDetails uses, including frequency and cost", () => {
    assert.equal(
      buildTispPackageLabel({
        planName: "Premium Plus",
        categoryName: "Internet + DSTV Channels + Apartonet Channels",
        paymentFrequency: "monthly",
        mbps: 250,
        price: 0,
      }),
      "250_PREMIUM_PLUS_INT_DSTV_APT_MONTHLY_0"
    );
  });

  it("keeps the same catalog name unique when frequency or cost differs", () => {
    const base = {
      planName: "Premium Plus",
      categoryName: "Internet + DSTV Channels + Apartonet Channels",
      mbps: 250,
    };
    assert.equal(
      buildTispPackageLabel({ ...base, paymentFrequency: "monthly", price: 4500 }),
      "250_PREMIUM_PLUS_INT_DSTV_APT_MONTHLY_4500"
    );
    assert.equal(
      buildTispPackageLabel({ ...base, paymentFrequency: "yearly", price: 4500 }),
      "250_PREMIUM_PLUS_INT_DSTV_APT_YEARLY_4500"
    );
    assert.equal(
      buildTispPackageLabel({ ...base, paymentFrequency: "monthly", price: 6500 }),
      "250_PREMIUM_PLUS_INT_DSTV_APT_MONTHLY_6500"
    );
    assert.equal(
      buildTispPackageLabel({
        ...base,
        paymentFrequency: "custom",
        customPeriodDays: 90,
        price: 4500,
      }),
      "250_PREMIUM_PLUS_INT_DSTV_APT_CUSTOM_90_4500"
    );
  });

  it("does not append frequency and cost twice", () => {
    const payload = buildTispSetPackagePayload({
      ...BASE_PACKAGE,
      packageLabel: "100_BASIC_INT_MONTHLY_4500",
    });
    assert.equal(
      payload.PackageDescription,
      "100_BASIC_INT_MONTHLY_4500"
    );
  });

  it("uses the same unique label on SetClientDetails Package", () => {
    const payload = buildTispCreateClientPayload({
      firstName: "Jane",
      lastName: "Doe",
      customerNumber: "ET-401A",
      planName: "Premium Plus",
      categoryName: "Internet + DSTV Channels + Apartonet Channels",
      paymentFrequency: "yearly",
      price: 12000,
      mbps: 250,
      apartmentNumber: "401A",
      tispPassword: "Ab1!xyz",
      popName: "Enaki",
      ipSetup: "STATIC",
      ipAddress: "10.10.10.25",
    });
    assert.equal(
      payload.Package,
      "250_PREMIUM_PLUS_INT_DSTV_APT_YEARLY_12000"
    );
  });
});
