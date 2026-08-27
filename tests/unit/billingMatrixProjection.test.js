const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  projectRecurringDatesInSpan,
  recurringMonthStep,
} = require("../../api/utils/billingMatrixProjection");

describe("projectRecurringDatesInSpan", () => {
  it("walks backward so an already-billed month still has a scheduled date", () => {
    const dates = projectRecurringDatesInSpan("2026-09-15", 2026, 8, 8, "monthly");
    assert.equal(dates.get("08"), "2026-08-15");
    assert.equal(dates.size, 1);
  });

  it("walks forward from a mid-span next date", () => {
    const dates = projectRecurringDatesInSpan("2026-08-05", 2026, 8, 10, "monthly");
    assert.equal(dates.get("08"), "2026-08-05");
    assert.equal(dates.get("09"), "2026-09-05");
    assert.equal(dates.get("10"), "2026-10-05");
    assert.equal(dates.size, 3);
  });

  it("does not fill months before the last-invoice month", () => {
    const dates = projectRecurringDatesInSpan("2026-09-15", 2026, 6, 8, "monthly", null, {
      notBefore: "2026-08-01",
    });
    assert.equal(dates.get("08"), "2026-08-15");
    assert.equal(dates.has("07"), false);
    assert.equal(dates.has("06"), false);
  });

  it("yearly cadence only lands on the anniversary month", () => {
    const dates = projectRecurringDatesInSpan("2027-01-20", 2026, 1, 8, "yearly", null, {
      notBefore: "2026-01-01",
    });
    assert.equal(dates.get("01"), "2026-01-20");
    assert.equal(dates.has("08"), false);
    assert.equal(dates.size, 1);
  });

  it("quarterly step skips in-between months", () => {
    const dates = projectRecurringDatesInSpan("2026-09-01", 2026, 6, 9, "quarterly");
    assert.equal(dates.get("06"), "2026-06-01");
    assert.equal(dates.get("09"), "2026-09-01");
    assert.equal(dates.has("07"), false);
    assert.equal(dates.has("08"), false);
  });

  it("clamps day-of-month for short months", () => {
    const dates = projectRecurringDatesInSpan("2026-03-31", 2026, 2, 3, "monthly");
    assert.equal(dates.get("02"), "2026-02-28");
    assert.equal(dates.get("03"), "2026-03-31");
  });
});

describe("recurringMonthStep", () => {
  it("maps frequency to month steps", () => {
    assert.equal(recurringMonthStep("monthly"), 1);
    assert.equal(recurringMonthStep("quarterly"), 3);
    assert.equal(recurringMonthStep("yearly"), 12);
    assert.equal(recurringMonthStep("custom", 45), 2);
  });
});
