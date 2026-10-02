const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  normalizeStartlyxSettings,
  toPublicStartlyxSettings,
  DEFAULT_STARTLYX_BASE_URL,
} = require("../../api/services/appSettingsStore");

describe("Startlyx IPTV settings", () => {
  it("uses saved values over env", () => {
    const next = normalizeStartlyxSettings(
      {
        baseUrl: "https://saved.example.com/",
        adminEmail: "saved@example.com",
        adminPassword: "saved-secret",
      },
      {
        STARTLYX_BASE_URL: "https://env.example.com",
        STARTLYX_ADMIN_EMAIL: "env@example.com",
        STARTLYX_ADMIN_PASSWORD: "env-secret",
      }
    );
    assert.equal(next.baseUrl, "https://saved.example.com");
    assert.equal(next.adminEmail, "saved@example.com");
    assert.equal(next.adminPassword, "saved-secret");
  });

  it("falls back to env and the default console URL", () => {
    const next = normalizeStartlyxSettings(
      {},
      {
        STARTLYX_ADMIN_EMAIL: "ops@example.com",
        STARTLYX_ADMIN_PASSWORD: "secret",
      }
    );
    assert.equal(next.baseUrl, DEFAULT_STARTLYX_BASE_URL);
    assert.equal(next.adminEmail, "ops@example.com");
    assert.equal(next.adminPassword, "secret");
  });

  it("hides the password in the public payload", () => {
    const publicSettings = toPublicStartlyxSettings({
      baseUrl: DEFAULT_STARTLYX_BASE_URL,
      adminEmail: "ops@example.com",
      adminPassword: "secret",
    });
    assert.equal(publicSettings.adminEmail, "ops@example.com");
    assert.equal(publicSettings.passwordConfigured, true);
    assert.equal(publicSettings.configured, true);
    assert.equal("adminPassword" in publicSettings, false);
  });
});
