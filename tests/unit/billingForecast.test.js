const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  windowMonthLabel,
  monthYearLabel,
  firstOccurrenceInWindow,
} = require("../../api/services/billingForecastStore");

describe("expected collections month labels", () => {
  it("names a single month", () => {
    assert.equal(monthYearLabel("2026-08-13"), "August 2026");
    assert.equal(windowMonthLabel("2026-08-01", "2026-08-31"), "August 2026");
  });

  it("names a 30-day window that spans two months", () => {
    assert.equal(
      windowMonthLabel("2026-08-13", "2026-09-12"),
      "August–September 2026"
    );
  });

  it("names a window that crosses a year", () => {
    assert.equal(
      windowMonthLabel("2026-12-20", "2027-01-19"),
      "December 2026–January 2027"
    );
  });
});

describe("B2B cadence landing in the 30-day window", () => {
  it("uses a next-invoice date already inside the window", () => {
    assert.equal(
      firstOccurrenceInWindow("2026-08-20", "monthly", null, "2026-08-13", "2026-09-12"),
      "2026-08-20"
    );
  });

  it("walks a stale next-invoice date forward into the window", () => {
    assert.equal(
      firstOccurrenceInWindow("2026-07-05", "monthly", null, "2026-08-13", "2026-09-12"),
      "2026-09-05"
    );
  });

  it("returns null when the next cycle is after the window", () => {
    assert.equal(
      firstOccurrenceInWindow("2026-09-20", "monthly", null, "2026-08-13", "2026-09-12"),
      null
    );
  });
});
