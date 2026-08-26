const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  mapPaymentFrequencyToRecurrence,
  recurrenceMatches,
  normalizeRecurrenceFrequency,
  selectRecurringProfileToUpdate,
} = require("../../api/utils/zohoRecurrence");

describe("recurrenceMatches against Zoho payloads", () => {
  const monthly = mapPaymentFrequencyToRecurrence("monthly");
  const quarterly = mapPaymentFrequencyToRecurrence("quarterly");
  const yearly = mapPaymentFrequencyToRecurrence("yearly");

  it("treats Zoho list rows (no cadence fields) as a match so we update in place", () => {
    const listRow = {
      recurring_invoice_id: "ri-1",
      recurrence_name: "ET-G405 - Quarterly",
      reference_number: "ET-G405",
      status: "active",
    };
    assert.equal(recurrenceMatches(listRow, quarterly), true);
    assert.equal(recurrenceMatches(listRow, monthly), true);
  });

  it("matches a full quarterly GET payload", () => {
    assert.equal(
      recurrenceMatches(
        { recurrence_frequency: "months", repeat_every: 3, status: "active" },
        quarterly
      ),
      true
    );
  });

  it("detects monthly vs quarterly from GET cadence fields", () => {
    assert.equal(
      recurrenceMatches(
        { recurrence_frequency: "months", repeat_every: 1 },
        quarterly
      ),
      false
    );
    assert.equal(
      recurrenceMatches(
        { recurrence_frequency: "months", repeat_every: 1 },
        monthly
      ),
      true
    );
  });

  it("normalizes display strings like Every 3 Months", () => {
    assert.equal(normalizeRecurrenceFrequency("Every 3 Months"), "months");
    assert.equal(normalizeRecurrenceFrequency("Monthly"), "months");
    assert.equal(normalizeRecurrenceFrequency("month"), "months");
    assert.equal(
      recurrenceMatches({ frequency: "Every 3 Months" }, quarterly),
      true
    );
    assert.equal(
      recurrenceMatches({ frequency: "Every 3 Months" }, monthly),
      false
    );
    assert.equal(recurrenceMatches({ frequency: "Monthly" }, monthly), true);
    assert.equal(recurrenceMatches({ frequency: "Monthly" }, quarterly), false);
    assert.equal(recurrenceMatches({ frequency: "Yearly" }, yearly), true);
  });

  it("prefers the active profile and leaves extras to stop", () => {
    const stopped = {
      recurring_invoice_id: "old",
      status: "stopped",
      recurrence_name: "ET-G405 - Quarterly",
    };
    const active = {
      recurring_invoice_id: "current",
      status: "active",
      recurrence_name: "ET-G405 - Quarterly Invoice",
    };
    const extra = {
      recurring_invoice_id: "dup",
      status: "active",
      recurrence_name: "ET-G405 - Monthly Invoice",
    };
    const picked = selectRecurringProfileToUpdate([stopped, active, extra]);
    assert.equal(picked.existing.recurring_invoice_id, "current");
    assert.equal(picked.extraActives.length, 1);
    assert.equal(picked.extraActives[0].recurring_invoice_id, "dup");
  });

  it("falls back to a stopped profile when none are active", () => {
    const stopped = {
      recurring_invoice_id: "old",
      status: "stopped",
    };
    const picked = selectRecurringProfileToUpdate([stopped]);
    assert.equal(picked.existing.recurring_invoice_id, "old");
    assert.equal(picked.extraActives.length, 0);
  });
});
