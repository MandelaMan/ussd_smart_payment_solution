/**
 * Replacing a Zoho recurring invoice must DELETE the previous profile
 * (not leave it stopped) so only the new one remains.
 */
const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  isZohoRecurringAlreadyGone,
  zohoRecurringDeleteNeedsStop,
  listRecurringIdsToRemove,
  recurringProfileId,
  recurringIdsForCustomerRemoval,
} = require("../../api/utils/zohoRecurrence");

function zohoErr(message, status = 400) {
  const err = new Error(message);
  err.response = { status, data: { message } };
  return err;
}

describe("Zoho recurring DELETE helpers", () => {
  it("treats 404 / not-found as already gone", () => {
    assert.equal(
      isZohoRecurringAlreadyGone(zohoErr("The recurring invoice does not exist.", 404)),
      true
    );
    assert.equal(
      isZohoRecurringAlreadyGone(zohoErr("Resource not found", 404)),
      true
    );
    assert.equal(
      isZohoRecurringAlreadyGone(zohoErr("Cannot delete active recurring invoice")),
      false
    );
  });

  it("stops first when Zoho rejects DELETE on an active profile", () => {
    assert.equal(
      zohoRecurringDeleteNeedsStop(
        zohoErr(
          "You cannot delete a recurring invoice that is in active status. Please stop it first."
        )
      ),
      true
    );
    assert.equal(
      zohoRecurringDeleteNeedsStop(
        zohoErr("This recurring invoice cannot be deleted.")
      ),
      true
    );
    assert.equal(
      zohoRecurringDeleteNeedsStop(
        zohoErr("The recurring invoice has been deleted.", 404)
      ),
      false
    );
  });
});

describe("previous recurring profiles are removed, keeper stays", () => {
  it("drops the kept id and dedupes extras", () => {
    const profiles = [
      { recurring_invoice_id: "keep" },
      { recurringinvoice_id: "old-stopped" },
      { recurring_invoice_id: "dup" },
      { recurring_invoice_id: "dup" },
      { recurring_invoice_id: "keep" },
    ];
    assert.deepEqual(listRecurringIdsToRemove(profiles, "keep"), [
      "old-stopped",
      "dup",
    ]);
  });

  it("removes every previous id when recreating (no keeper)", () => {
    const profiles = [
      { recurring_invoice_id: "old-monthly" },
      { recurring_invoice_id: "old-quarterly" },
    ];
    assert.deepEqual(listRecurringIdsToRemove(profiles, ""), [
      "old-monthly",
      "old-quarterly",
    ]);
    assert.equal(recurringProfileId(profiles[0]), "old-monthly");
  });
});

describe("cancel removes every matching recurring profile", () => {
  it("includes stopped leftovers and ignores other customers", () => {
    const profiles = [
      {
        recurring_invoice_id: "active",
        status: "active",
        reference_number: "ET-H302",
        recurrence_name: "ET-H302 - Monthly Invoice",
      },
      {
        recurring_invoice_id: "stopped",
        status: "stopped",
        reference_number: "ET-H302",
        recurrence_name: "ET-H302 - Quarterly Invoice",
      },
      {
        recurring_invoice_id: "other",
        status: "active",
        reference_number: "ET-H303",
        recurrence_name: "ET-H303 - Monthly Invoice",
      },
    ];
    assert.deepEqual(recurringIdsForCustomerRemoval(profiles, "ET-H302"), [
      "active",
      "stopped",
    ]);
  });
});
