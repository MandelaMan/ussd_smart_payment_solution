const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  addCalendarDays,
  computePauseCredit,
  nextRecurringStartAfterPause,
  resolveStoredPauseCredit,
} = require("../../api/utils/pauseCredit");

describe("pause subscription credit", () => {
  it("credits the away days onto the original due date", () => {
    const credit = computePauseCredit({
      pauseStart: "2026-03-10",
      pauseEnd: "2026-03-25",
      originalDueDate: "2026-04-01",
    });
    assert.equal(credit.creditDays, 15);
    assert.equal(credit.creditedDueDate, "2026-04-16");
  });

  it("does not count the return date as a day away", () => {
    const credit = computePauseCredit({
      pauseStart: "2026-03-10",
      pauseEnd: "2026-03-11",
      originalDueDate: "2026-04-01",
    });
    assert.equal(credit.creditDays, 1);
    assert.equal(credit.creditedDueDate, "2026-04-02");
  });

  it("credits from the return date when there is no original due", () => {
    const credit = computePauseCredit({
      pauseStart: "2026-03-10",
      pauseEnd: "2026-03-25",
    });
    assert.equal(credit.creditDays, 15);
    assert.equal(credit.creditedDueDate, "2026-04-09");
  });

  it("shifts the next Zoho invoice by the credited days, not before pause end", () => {
    assert.equal(
      nextRecurringStartAfterPause({
        nextInvoiceDate: "2026-03-25",
        pauseEnd: "2026-03-25",
        creditDays: 15,
      }),
      "2026-04-09"
    );
    assert.equal(
      nextRecurringStartAfterPause({
        nextInvoiceDate: "2026-03-20",
        pauseEnd: "2026-04-10",
        creditDays: 15,
      }),
      "2026-04-10"
    );
  });

  it("adds calendar days without UTC drift", () => {
    assert.equal(addCalendarDays("2026-03-25", 15), "2026-04-09");
  });

  it("treats stored unused credit as pending until applied", () => {
    const pending = resolveStoredPauseCredit({
      pauseCreditDays: 12,
      pauseStartDate: "2026-03-10",
      pauseEndDate: "2026-03-22",
      pauseCreditedDueDate: "2026-04-13",
    });
    assert.equal(pending.pending, true);
    assert.equal(pending.creditDays, 12);

    const applied = resolveStoredPauseCredit({
      pauseCreditDays: 12,
      pauseCreditAppliedAt: "2026-04-10T08:00:00.000Z",
    });
    assert.equal(applied.pending, false);
    assert.equal(applied.applied, true);
  });
});
