const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  formatDueDisplay,
  notificationRecipientIds,
  mergeActionItemHistory,
  pendingChecklistCount,
  assertCanComplete,
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

  it("builds an activity trail from stored events and older checklist completions", () => {
    const item = {
      createdAt: "2026-08-01 10:00:00",
      createdBy: 1,
      createdByName: "Alex",
      status: "in_progress",
      completedAt: null,
      completedBy: null,
      completedByName: null,
      steps: [
        {
          id: 11,
          label: "Install / reconnect ONU",
          status: "done",
          completedAt: "2026-08-02 09:15:00",
          completedBy: 4,
          completedByName: "Brian Onduyu",
        },
      ],
    };
    const stored = [
      {
        id: 50,
        type: "notes_updated",
        message: "Updated internal notes",
        detail: "Customer wants installation done",
        actorName: "Mary Atieno",
        createdAt: "2026-08-03 11:00:00",
        metadata: {},
      },
    ];
    const merged = mergeActionItemHistory(item, stored);
    assert.equal(merged[0].type, "notes_updated");
    assert.equal(merged[0].actorName, "Mary Atieno");
    assert.ok(merged.some((event) => event.type === "created" && event.actorName === "Alex"));
    const stepEvent = merged.find((event) => event.type === "step_done");
    assert.ok(stepEvent);
    assert.match(stepEvent.message, /Install \/ reconnect ONU/);
    assert.equal(stepEvent.actorName, "Brian Onduyu");
  });

  it("does not duplicate a checklist event that was already logged", () => {
    const item = {
      createdAt: "2026-08-01 10:00:00",
      createdByName: "Alex",
      status: "completed",
      completedAt: "2026-08-04 16:00:00",
      completedByName: "Nelson Omoro",
      steps: [
        {
          id: 11,
          label: "Activate service",
          status: "done",
          completedAt: "2026-08-04 15:50:00",
          completedByName: "Nelson Omoro",
        },
      ],
    };
    const stored = [
      {
        id: 1,
        type: "created",
        message: "Created this reminder",
        actorName: "Alex",
        createdAt: "2026-08-01 10:00:00",
        metadata: {},
      },
      {
        id: 2,
        type: "step_done",
        message: "Completed “Activate service”",
        actorName: "Nelson Omoro",
        createdAt: "2026-08-04 15:50:00",
        metadata: { stepId: 11 },
      },
      {
        id: 3,
        type: "status_changed",
        message: "Marked completed",
        actorName: "Nelson Omoro",
        createdAt: "2026-08-04 16:00:00",
        metadata: { status: "completed" },
      },
    ];
    const merged = mergeActionItemHistory(item, stored);
    assert.equal(merged.filter((event) => event.type === "created").length, 1);
    assert.equal(merged.filter((event) => event.type === "step_done").length, 1);
    assert.equal(merged.filter((event) => event.type === "status_changed").length, 1);
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

  it("blocks completion while checklist items are still pending", () => {
    const open = {
      steps: [
        { status: "done" },
        { status: "pending" },
      ],
    };
    assert.equal(pendingChecklistCount(open), 1);
    assert.throws(
      () => assertCanComplete(open),
      /remaining checklist item/
    );
    assert.equal(pendingChecklistCount({ steps: [] }), 0);
    assert.doesNotThrow(() => assertCanComplete({ steps: [] }));
    assert.doesNotThrow(() =>
      assertCanComplete({ steps: [{ status: "done" }, { status: "skipped" }] })
    );
  });
});
