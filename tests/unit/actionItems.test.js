const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  formatDueDisplay,
  notificationRecipientIds,
  VALID_STATUSES,
  VALID_PRIORITIES,
} = require("../../api/services/actionItemStore");
const {
  CUSTOMER_EMAIL_TEMPLATE_DEFS,
  CUSTOMER_EMAIL_TEMPLATE_KEYS,
} = require("../../api/services/appSettingsStore");
const { allPermissionKeys, getPermission, GROUP_PRESETS } = require("../../api/rbac/permissionCatalog");

describe("action item reminders", () => {
  it("accepts known statuses and priorities", () => {
    assert.ok(VALID_STATUSES.has("open"));
    assert.ok(VALID_STATUSES.has("in_progress"));
    assert.ok(VALID_STATUSES.has("completed"));
    assert.ok(VALID_PRIORITIES.has("urgent"));
  });

  it("formats due dates in a stable en-GB style", () => {
    assert.equal(formatDueDisplay("2026-08-31"), "31 Aug 2026");
    assert.equal(formatDueDisplay(null), "");
  });

  it("registers customer emails for opened and completed reminders", () => {
    assert.ok(CUSTOMER_EMAIL_TEMPLATE_KEYS.includes("action_opened"));
    assert.ok(CUSTOMER_EMAIL_TEMPLATE_KEYS.includes("action_completed"));
    assert.ok(CUSTOMER_EMAIL_TEMPLATE_KEYS.includes("installation_completed"));
    assert.ok(CUSTOMER_EMAIL_TEMPLATE_KEYS.includes("installation_cancelled"));
    assert.match(CUSTOMER_EMAIL_TEMPLATE_DEFS.action_opened.defaultBodyHtml, /actionTypeName/);
    assert.match(CUSTOMER_EMAIL_TEMPLATE_DEFS.action_completed.defaultSubject, /customerNumber/);
    assert.match(
      CUSTOMER_EMAIL_TEMPLATE_DEFS.installation_cancelled.defaultBodyHtml,
      /cancellationReason/
    );
    assert.match(
      CUSTOMER_EMAIL_TEMPLATE_DEFS.installation_completed.defaultBodyHtml,
      /wecare@sulsolutions\.biz/
    );
  });

  it("notifies every tagged user on assign, including the person who created it", () => {
    assert.deepEqual(
      notificationRecipientIds([4, 7, 4], { type: "action_assigned", actorId: 4 }),
      [4, 7]
    );
    assert.deepEqual(
      notificationRecipientIds(["4", 7], { type: "action_assigned" }),
      [4, 7]
    );
  });

  it("does not ping the person who just completed a reminder", () => {
    assert.deepEqual(
      notificationRecipientIds([4, 7], { type: "action_completed", actorId: 4 }),
      [7]
    );
  });

  it("exposes reminder permissions and support group access", () => {
    for (const key of [
      "action_items.view",
      "action_items.create",
      "action_items.assign",
      "action_items.edit",
    ]) {
      assert.ok(getPermission(key), `missing ${key}`);
      assert.ok(allPermissionKeys().includes(key));
    }
    const sales = GROUP_PRESETS.find((g) => g.slug === "sales");
    const support = GROUP_PRESETS.find((g) => g.slug === "support");
    assert.ok(support.permissions.includes("action_items.create"));
    assert.ok(support.permissions.includes("action_items.edit"));
    assert.ok(sales.permissions.includes("action_items.assign"));
    assert.ok(sales.permissions.includes("action_items.edit"));
  });
});
