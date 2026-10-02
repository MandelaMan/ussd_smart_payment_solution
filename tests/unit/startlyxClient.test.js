const { describe, it, beforeEach, afterEach } = require("node:test");
const { assert } = require("../helpers");
const {
  normalizeBaseUrl,
  unwrapList,
  unwrapSuccess,
  extractAccessToken,
  extractErrorMessage,
  decodeJwtExpiryMs,
  buildCreateUserPayload,
  buildUpdateUserPayload,
  buildSubscribePayload,
  mapChannel,
  mapPackage,
  mapUser,
  matchUser,
  isActiveSubscription,
  pickReconnectPackage,
  isConfigured,
  publicStatus,
  resetAuthCache,
  applySavedSettings,
  getConfig,
  DEFAULT_BASE_URL,
  accessStatusFromSubscriptions,
} = require("../../api/services/startlyx/startlyxClient");

describe("startlyx client helpers", () => {
  const prev = {};

  beforeEach(() => {
    resetAuthCache();
    for (const key of [
      "STARTLYX_BASE_URL",
      "STARTLYX_ADMIN_EMAIL",
      "STARTLYX_ADMIN_PASSWORD",
    ]) {
      prev[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    resetAuthCache();
  });

  it("normalizes the console URL", () => {
    assert.equal(
      normalizeBaseUrl("https://startlyx.iptvconsole.hydeinnovations.com/"),
      "https://startlyx.iptvconsole.hydeinnovations.com"
    );
    assert.equal(
      normalizeBaseUrl(
        "https://startlyx.iptvconsole.hydeinnovations.com/doc/api/reference"
      ),
      "https://startlyx.iptvconsole.hydeinnovations.com"
    );
    assert.equal(normalizeBaseUrl(""), DEFAULT_BASE_URL);
  });

  it("unwraps list envelopes", () => {
    assert.deepEqual(unwrapList([{ id: 1 }]), [{ id: 1 }]);
    assert.deepEqual(unwrapList({ items: [{ id: 2 }] }), [{ id: 2 }]);
    assert.deepEqual(unwrapList({ packages: [{ id: 3 }] }), [{ id: 3 }]);
    assert.deepEqual(unwrapList(null), []);
  });

  it("unwraps success envelopes and access tokens", () => {
    assert.deepEqual(unwrapSuccess({ status: "success", data: { access_token: "abc" } }), {
      access_token: "abc",
    });
    assert.equal(extractAccessToken({ status: "success", data: { access_token: "abc" } }), "abc");
    assert.equal(extractAccessToken({ access_token: "xyz" }), "xyz");
    assert.equal(extractAccessToken({ status: "success", data: {} }), null);
  });

  it("extracts ErrorView messages", () => {
    assert.equal(
      extractErrorMessage({ code: "ACT-1", message: "Email already registered" }, "x"),
      "Email already registered"
    );
    assert.equal(extractErrorMessage("<html>", "fallback"), "fallback");
  });

  it("decodes JWT expiry", () => {
    const payload = Buffer.from(
      JSON.stringify({ exp: 1_800_000_000 }),
      "utf8"
    ).toString("base64url");
    assert.equal(decodeJwtExpiryMs(`aaa.${payload}.sig`), 1_800_000_000_000);
    assert.equal(decodeJwtExpiryMs("not-a-jwt"), null);
  });

  it("builds create-user and subscribe payloads", () => {
    assert.deepEqual(
      buildCreateUserPayload({
        email: "  Sue@Example.com ",
        username: " ET-401A ",
        phoneNumber: "+254712345678",
        address: "102.68.10.24",
      }),
      {
        email: "sue@example.com",
        username: "ET-401A",
        phone_number: "+254712345678",
        address: "102.68.10.24",
      }
    );
    assert.deepEqual(
      buildSubscribePayload({
        userId: "01USER",
        packageId: "01PKG",
        durationMonths: 3,
      }),
      {
        user_id: "01USER",
        package_id: "01PKG",
        duration_months: 3,
      }
    );
  });

  it("maps channel live state", () => {
    const mapped = mapChannel({
      id: "01CH",
      name: "Citizen TV",
      channel_number: "12",
      category_id: "01CAT",
      enabled: true,
      drm_enabled: false,
      state: {
        status: "running",
        alive: true,
        client_count: 4,
        last_error: null,
      },
    }, "News");
    assert.equal(mapped.status, "running");
    assert.equal(mapped.categoryName, "News");
    assert.equal(mapped.clientCount, 4);
    assert.equal(mapped.enabled, true);
  });

  it("maps packages and users", () => {
    const pkg = mapPackage({
      id: "01P",
      package_name: "Premium Monthly",
      rank: 2,
      price: "1499.0",
      currency: "KES",
      number_of_allowed_sessions: 1,
      number_of_channels: 80,
      features: ["catch_up"],
      active: true,
    });
    assert.equal(pkg.name, "Premium Monthly");
    assert.equal(pkg.sessions, 1);
    const user = mapUser({
      id: "01U",
      email: "a@b.com",
      username: "ET-401A",
      phone_number: "+2547",
      status: "Suspended",
      starlynx_user_id: "01S",
    });
    assert.equal(user.username, "ET-401A");
    assert.equal(user.status, "suspended");
    assert.equal(user.starlynxUserId, "01S");
  });

  it("builds a user update payload with status", () => {
    assert.deepEqual(buildUpdateUserPayload({ status: "Suspended" }), {});
    assert.deepEqual(
      buildUpdateUserPayload({ status: "active", username: " kept " }),
      { username: "kept" }
    );
    assert.deepEqual(buildUpdateUserPayload({}), {});
  });

  it("derives user access from subscriptions", () => {
    assert.equal(accessStatusFromSubscriptions([]), "no_subscription");
    assert.equal(
      accessStatusFromSubscriptions([
        { status: "cancelled", startDate: "2026-09-01" },
        { status: "active", startDate: "2026-08-01" },
      ]),
      "active"
    );
    assert.equal(
      accessStatusFromSubscriptions([
        { status: "expired", startDate: "2026-08-01" },
        { status: "cancelled", startDate: "2026-09-01" },
      ]),
      "disconnected"
    );
    assert.equal(
      accessStatusFromSubscriptions([{ status: "expired", startDate: "2026-08-01" }]),
      "expired"
    );
  });

  it("matches existing users by email then username", () => {
    const users = [
      { id: "1", email: "a@b.com", username: "ET-1" },
      { id: "2", email: "c@d.com", username: "ET-2" },
    ];
    assert.equal(matchUser(users, { email: "A@B.com" }).id, "1");
    assert.equal(matchUser(users, { username: "et-2" }).id, "2");
    assert.equal(matchUser(users, { email: "missing@x.com", username: "nope" }), null);
  });

  it("picks reconnect packages and active subscriptions", () => {
    assert.equal(isActiveSubscription({ status: "Active" }), true);
    assert.equal(isActiveSubscription({ status: "cancelled" }), false);
    assert.equal(
      pickReconnectPackage(
        [
          { packageId: "old", status: "expired" },
          { packageId: "dstv", status: "cancelled" },
        ],
        ""
      ),
      "dstv"
    );
    assert.equal(pickReconnectPackage([{ packageId: "kept", status: "cancelled" }], "preferred"), "preferred");
    assert.equal(pickReconnectPackage([]), null);
  });

  it("reports configuration from env", () => {
    delete process.env.STARTLYX_ADMIN_EMAIL;
    delete process.env.STARTLYX_ADMIN_PASSWORD;
    assert.equal(isConfigured(), false);
    process.env.STARTLYX_ADMIN_EMAIL = "ops@example.com";
    process.env.STARTLYX_ADMIN_PASSWORD = "secret";
    assert.equal(isConfigured(), true);
    assert.equal(publicStatus().adminEmail, "o***@example.com");
  });

  it("prefers saved settings over env", () => {
    process.env.STARTLYX_BASE_URL = "https://env.example.com/";
    process.env.STARTLYX_ADMIN_EMAIL = "env@example.com";
    process.env.STARTLYX_ADMIN_PASSWORD = "env-secret";
    applySavedSettings({
      baseUrl: "https://saved.example.com/",
      adminEmail: "saved@example.com",
      adminPassword: "saved-secret",
    });
    const cfg = getConfig();
    assert.equal(cfg.baseUrl, "https://saved.example.com");
    assert.equal(cfg.email, "saved@example.com");
    assert.equal(cfg.password, "saved-secret");
    assert.equal(isConfigured(), true);
  });
});
