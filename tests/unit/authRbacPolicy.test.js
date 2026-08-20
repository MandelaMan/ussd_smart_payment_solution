const { describe, it } = require("node:test");
const crypto = require("node:crypto");
const { assert } = require("../helpers");
const { validatePassword } = require("../../api/utils/passwordPolicy");
const {
  isAccountLocked,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MINUTES,
} = require("../../api/utils/accountLockout");
const { timingSafeEqualString } = require("../../api/utils/timingSafeEqual");
const {
  allPermissionKeys,
  getPermission,
  USER_ROLE_DEFAULTS,
  GROUP_PRESETS,
  LEGACY_ROLE_GROUPS,
  MODULES,
} = require("../../api/rbac/permissionCatalog");
const { mayCallZohoForCustomer, isScheduledZohoModule } = require("../../api/lib/zohoSyncPolicy");
const {
  buildingToBillingAddress,
  formatPoBox,
} = require("../../api/utils/buildingBillingAddress");
const {
  formatDateOnly,
  pickLatestPaymentDate,
  lastPaymentFromZohoInvoices,
} = require("../../api/utils/lastPaymentDate");

describe("auth: password policy + lockout", () => {
  it("enforces letter+number and length bounds", () => {
    assert.ok(validatePassword("abc"));
    assert.ok(validatePassword("abcdefgh"));
    assert.ok(validatePassword("12345678"));
    assert.equal(validatePassword("SecurePass1"), null);
    assert.ok(validatePassword("a1".repeat(65)));
  });

  it("locks after threshold with future locked_until", () => {
    assert.equal(MAX_FAILED_ATTEMPTS, 5);
    assert.equal(LOCKOUT_MINUTES, 30);
    assert.equal(isAccountLocked({ locked_until: null }), false);
    assert.equal(
      isAccountLocked({
        locked_until: new Date(Date.now() + 60_000).toISOString(),
      }),
      true
    );
    assert.equal(
      isAccountLocked({
        locked_until: new Date(Date.now() - 60_000).toISOString(),
      }),
      false
    );
  });

  it("timing-safe compare rejects length mismatch and empty", () => {
    assert.equal(timingSafeEqualString("abc", "abc"), true);
    assert.equal(timingSafeEqualString("abc", "abd"), false);
    assert.equal(timingSafeEqualString("abc", "ab"), false);
    assert.equal(timingSafeEqualString("", ""), false);
  });
});

describe("RBAC permission catalog integrity", () => {
  it("has unique permission keys across modules", () => {
    const keys = allPermissionKeys();
    assert.ok(keys.length > 20);
    assert.equal(keys.length, new Set(keys).size);
  });

  it("customer lifecycle permissions exist", () => {
    for (const key of [
      "customers.view",
      "customers.create",
      "customers.edit",
      "customers.cancel",
      "customers.pause",
      "customers.disconnect",
      "customers.delete",
      "billing.allocate",
      "billing.actions",
    ]) {
      assert.ok(getPermission(key), `missing ${key}`);
    }
  });

  it("dangerous permissions are marked", () => {
    assert.equal(getPermission("customers.delete").dangerous, true);
    assert.equal(getPermission("billing.refund").dangerous, true);
  });

  it("group presets only reference known permission keys", () => {
    const known = new Set(allPermissionKeys());
    for (const group of GROUP_PRESETS) {
      for (const key of group.permissions) {
        assert.ok(known.has(key), `${group.slug} unknown permission ${key}`);
      }
    }
  });

  it("role defaults only reference known permission keys", () => {
    const known = new Set(allPermissionKeys());
    for (const key of USER_ROLE_DEFAULTS) {
      assert.ok(known.has(key), `USER_ROLE_DEFAULTS unknown permission ${key}`);
    }
  });

  it("installations and reminders are catalog modules granted to operating groups", () => {
    const moduleKeys = MODULES.map((mod) => mod.key);
    assert.ok(moduleKeys.includes("installations"));
    assert.ok(moduleKeys.includes("action_items"));

    for (const key of [
      "installations.view",
      "installations.assign",
      "installations.edit",
      "action_items.view",
      "action_items.create",
      "action_items.assign",
      "action_items.edit",
    ]) {
      assert.ok(getPermission(key), `missing ${key}`);
    }

    const bySlug = Object.fromEntries(GROUP_PRESETS.map((g) => [g.slug, g.permissions]));
    for (const slug of ["support", "network-operations", "installations", "sales"]) {
      assert.ok(bySlug[slug].includes("action_items.view"), `${slug} missing reminders.view`);
      assert.ok(bySlug[slug].includes("installations.view"), `${slug} missing installations.view`);
    }
    assert.ok(bySlug.support.includes("action_items.assign"));
    assert.ok(bySlug.sales.includes("action_items.create"));
    assert.ok(bySlug.technician.includes("installations.edit"));
    assert.ok(USER_ROLE_DEFAULTS.includes("action_items.view"));
    assert.ok(USER_ROLE_DEFAULTS.includes("action_items.assign"));
    assert.ok(USER_ROLE_DEFAULTS.includes("installations.view"));
  });

  it("every operational module view is granted by a preset or role default", () => {
    const granted = new Set([
      ...USER_ROLE_DEFAULTS,
      ...GROUP_PRESETS.flatMap((g) => g.permissions),
    ]);
    const skip = new Set(["users.view", "settings.view", "system_logs.view"]);
    for (const mod of MODULES) {
      const view = mod.permissions.find((p) => p.key.endsWith(".view"));
      if (!view || skip.has(view.key)) continue;
      assert.ok(granted.has(view.key), `${view.key} is not assigned to any role or group`);
    }
  });

  it("legacy role map points at known group slugs", () => {
    const slugs = new Set(GROUP_PRESETS.map((g) => g.slug));
    for (const [role, groups] of Object.entries(LEGACY_ROLE_GROUPS)) {
      for (const slug of groups) {
        assert.ok(slugs.has(slug), `${role} → ${slug}`);
      }
    }
    assert.ok(USER_ROLE_DEFAULTS.length >= 1);
    assert.ok(MODULES.length >= 5);
  });
});

describe("Zoho sync policy gates", () => {
  it("mayCallZohoForCustomer requires explicit allow/refresh", () => {
    assert.equal(mayCallZohoForCustomer({}), false);
    assert.equal(mayCallZohoForCustomer({ skipZoho: true }), false);
    assert.equal(mayCallZohoForCustomer({ refreshZoho: true }), true);
    assert.equal(mayCallZohoForCustomer({ allowZohoApi: true }), true);
    assert.equal(
      mayCallZohoForCustomer({ skipZoho: true, refreshZoho: true }),
      true
    );
  });

  it("minimal mode schedules contacts + invoices by default", () => {
    const prevMode = process.env.ZOHO_SYNC_MODE;
    const prevMods = process.env.ZOHO_SCHEDULED_MODULES;
    process.env.ZOHO_SYNC_MODE = "minimal";
    delete process.env.ZOHO_SCHEDULED_MODULES;
    try {
      assert.equal(isScheduledZohoModule("zoho-contacts"), true);
      assert.equal(isScheduledZohoModule("invoices"), true);
      assert.equal(isScheduledZohoModule("zoho-estimates"), false);
    } finally {
      if (prevMode == null) delete process.env.ZOHO_SYNC_MODE;
      else process.env.ZOHO_SYNC_MODE = prevMode;
      if (prevMods == null) delete process.env.ZOHO_SCHEDULED_MODULES;
      else process.env.ZOHO_SCHEDULED_MODULES = prevMods;
    }
  });
});

describe("building billing address + last payment date", () => {
  it("maps building postal address into Zoho billing_* fields", () => {
    const mapped = buildingToBillingAddress({
      address_street: "Kenyatta Ave",
      address_city: "Nairobi",
      address_po_box: "12345",
    });
    assert.equal(mapped.billingAddress, "Kenyatta Ave");
    assert.equal(mapped.billingStreet2, "P.O. Box 12345");
    assert.equal(mapped.billingCity, "Nairobi");
    assert.equal(mapped.billingCountry, "Kenya");
    assert.equal(formatPoBox("99"), "P.O. Box 99");
  });

  it("uses the building name when street is missing", () => {
    const mapped = buildingToBillingAddress({
      name: "Kilimani Heights",
      address_city: "Nairobi",
    });
    assert.equal(mapped.billingAddress, "Kilimani Heights");
    assert.equal(mapped.billingCity, "Nairobi");
    assert.equal(mapped.billingCountry, "Kenya");
  });

  it("picks latest payment date from Zoho invoices", () => {
    assert.equal(formatDateOnly("2026-08-01T12:00:00Z"), "2026-08-01");
    assert.equal(
      pickLatestPaymentDate("2026-01-01", "2026-03-15", null),
      "2026-03-15"
    );
    assert.equal(
      lastPaymentFromZohoInvoices([
        { status: "sent", balance: 100, date: "2026-01-01" },
        { status: "paid", date: "2026-02-10", last_payment_date: "2026-02-09" },
      ]),
      "2026-02-09"
    );
  });
});

describe("WhatsApp webhook HMAC shape (crypto contract)", () => {
  it("sha256 HMAC matches Meta signature format", () => {
    const { verifyWhatsAppHmac } = require("../../api/middleware/webhookVerify");
    const secret = "test-app-secret";
    const body = Buffer.from(JSON.stringify({ entry: [] }));
    const sig =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(body).digest("hex");
    assert.equal(verifyWhatsAppHmac(sig, body, secret).ok, true);
    assert.equal(verifyWhatsAppHmac("sha256=deadbeef", body, secret).ok, false);
  });
});
