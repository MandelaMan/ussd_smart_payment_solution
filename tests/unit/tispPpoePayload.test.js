/**
 * TISP SetClientDetails network fields: PPOE buildings vs STATIC buildings.
 */
const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  buildTispCreateClientPayload,
  buildTispUpdateClientDetailsPayload,
  stringifyTispCreatePayload,
  resolveTispNetworkFields,
  resolveTispPackageType,
} = require("../../api/controllers/tisp.controller");
const {
  TISP_PPOE_PLACEHOLDER_STATIC_IP,
  TISP_RELEASE_PLACEHOLDER_IP,
  isTispPlaceholderIp,
} = require("../../api/utils/tispConstants");

const baseInput = {
  firstName: "Jane",
  lastName: "Doe",
  customerNumber: "AZE-TGA-401A",
  planName: "Basic Plus",
  categoryName: "Internet + Apartonet Channels",
  apartmentNumber: "401A",
  tispPassword: "Ab1!xyz",
  email: "jane@example.com",
  phone: "0712345678",
};

describe("TISP PackageType from building IP setup", () => {
  it("maps PPOE building → PPPOE", () => {
    assert.equal(resolveTispPackageType("PPOE"), "PPPOE");
    assert.equal(resolveTispPackageType("pppoe"), "PPPOE");
  });

  it("maps STATIC building → IP", () => {
    assert.equal(resolveTispPackageType("STATIC"), "IP");
    assert.equal(resolveTispPackageType("IP"), "IP");
  });
});

describe("TISP network fields: PPOE vs STATIC buildings", () => {
  it("PPOE uses placeholder StaticIP 10.2.2.2 and blank remote address", () => {
    const fields = resolveTispNetworkFields("PPOE", "");
    assert.equal(fields.packageType, "PPPOE");
    assert.equal(fields.staticIpAddress, "10.2.2.2");
    assert.equal(fields.pppoeRemoteAddress, "");
  });

  it("PPOE ignores a local IP and still blanks the remote address", () => {
    const fields = resolveTispNetworkFields("PPOE", "192.168.88.10");
    assert.equal(fields.staticIpAddress, TISP_PPOE_PLACEHOLDER_STATIC_IP);
    assert.equal(fields.pppoeRemoteAddress, "");
  });

  it("STATIC uses the assigned IP on both StaticIP and PppoeRemoteAddress", () => {
    const fields = resolveTispNetworkFields("STATIC", "10.10.10.25");
    assert.equal(fields.packageType, "IP");
    assert.equal(fields.staticIpAddress, "10.10.10.25");
    assert.equal(fields.pppoeRemoteAddress, "10.10.10.25");
  });

  it("PPOE release keeps 0.0.0.0 on StaticIP and leaves remote blank", () => {
    const fields = resolveTispNetworkFields("PPOE", TISP_RELEASE_PLACEHOLDER_IP);
    assert.equal(fields.staticIpAddress, TISP_RELEASE_PLACEHOLDER_IP);
    assert.equal(fields.pppoeRemoteAddress, "");
  });
});

describe("TISP create payload for PPOE vs STATIC buildings", () => {
  it("PPOE INSERT sets PackageType PPPOE, StaticIP 10.2.2.2, blank PppoeRemoteAddress", () => {
    const payload = buildTispCreateClientPayload({
      ...baseInput,
      buildingName: "Azalea",
      ipSetup: "PPOE",
      ppoeUsername: "AZE-TGA-401A",
      ipAddress: "",
    });
    assert.equal(payload.TransactionType, "INSERT");
    assert.equal(payload.PackageType, "PPPOE");
    assert.equal(payload.StaticIPAddress, "10.2.2.2");
    assert.equal(payload.PppoeRemoteAddress, "");
    assert.equal(payload.PppoeUsername, "AZE-TGA-401A");
  });

  it("STATIC INSERT sets PackageType IP and copies the assigned IP to both fields", () => {
    const payload = buildTispCreateClientPayload({
      ...baseInput,
      buildingName: "Enaki",
      customerNumber: "ET-401A",
      ipSetup: "STATIC",
      ipAddress: "10.10.10.25",
    });
    assert.equal(payload.PackageType, "IP");
    assert.equal(payload.StaticIPAddress, "10.10.10.25");
    assert.equal(payload.PppoeRemoteAddress, "10.10.10.25");
  });

  it("compact create JSON keeps blank PppoeRemoteAddress for PPOE", () => {
    const payload = buildTispCreateClientPayload({
      ...baseInput,
      buildingName: "Azalea",
      ipSetup: "PPOE",
      ppoeUsername: "AZE-TGA-401A",
    });
    const wire = stringifyTispCreatePayload(payload);
    assert.match(wire, /"StaticIPAddress":"10.2.2.2"/);
    assert.match(wire, /"PppoeRemoteAddress":""/);
    assert.match(wire, /"PackageType":"PPPOE"/);
  });
});

describe("TISP placeholder IPs are not treated as real static IPs", () => {
  it("recognizes 0.0.0.0 and 10.2.2.2 as placeholders", () => {
    assert.equal(isTispPlaceholderIp("0.0.0.0"), true);
    assert.equal(isTispPlaceholderIp("10.2.2.2"), true);
    assert.equal(isTispPlaceholderIp("10.10.10.25"), false);
  });
});

describe("TISP B2B Skynest placeholder names", () => {
  it("keeps First/Middle/Last as lowercase user on UPDATE", () => {
    const payload = buildTispUpdateClientDetailsPayload({
      ...baseInput,
      firstName: "user",
      middleName: "user",
      lastName: "user",
      buildingName: "Skynest",
      customerNumber: "SKYB-302",
      customerType: "B2B",
      ipSetup: "STATIC",
      ipAddress: "192.168.88.10",
    });
    assert.equal(payload.TransactionType, "UPDATE");
    assert.equal(payload.FirstName, "user");
    assert.equal(payload.MiddleName, "user");
    assert.equal(payload.LastName, "user");
  });

  it("still uppercases names for other B2B houses", () => {
    const payload = buildTispUpdateClientDetailsPayload({
      ...baseInput,
      firstName: "Jane",
      middleName: "Q",
      lastName: "Doe",
      buildingName: "Azalea",
      customerNumber: "AZEB-TGA-401A",
      customerType: "B2B",
      ipSetup: "PPOE",
      ppoeUsername: "AZEB-TGA-401A",
    });
    assert.equal(payload.FirstName, "JANE");
    assert.equal(payload.LastName, "DOE");
  });
});
