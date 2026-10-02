const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  addCalendarDays,
  assertPauseDurationAllowed,
  computePauseCredit,
  computePauseCreditAmount,
  exhaustedPauseDaysMessage,
  maxPauseEndDate,
  nextRecurringStartAfterPause,
  pauseAllowanceDays,
  pauseMaxDuration,
  resolvePauseBalance,
  pauseStatusToRestore,
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

  it("caps pause length by payment frequency", () => {
    assert.equal(pauseMaxDuration("monthly").label, "1 week");
    assert.equal(pauseMaxDuration("quarterly").label, "2 weeks");
    assert.equal(pauseMaxDuration("yearly").label, "1 month");
    assert.equal(maxPauseEndDate("2026-03-10", "monthly"), "2026-03-17");
    assert.equal(maxPauseEndDate("2026-03-10", "quarterly"), "2026-03-24");
    assert.equal(maxPauseEndDate("2026-01-31", "yearly"), "2026-02-28");
    assert.doesNotThrow(() =>
      assertPauseDurationAllowed({
        pauseStart: "2026-03-10",
        pauseEnd: "2026-03-17",
        paymentFrequency: "monthly",
      })
    );
    assert.throws(
      () =>
        assertPauseDurationAllowed({
          pauseStart: "2026-03-10",
          pauseEnd: "2026-03-18",
          paymentFrequency: "monthly",
        }),
      /1 week only/
    );
    assert.throws(
      () =>
        assertPauseDurationAllowed({
          pauseStart: "2026-03-10",
          pauseEnd: "2026-03-25",
          paymentFrequency: "quarterly",
        }),
      /2 weeks only/
    );
  });

  it("prorates unused pause days as a Zoho credit amount", () => {
    const { computeBillingPeriod } = require("../../api/utils/billingPeriod");
    const monthlyPeriod = computeBillingPeriod({ paymentFrequency: "monthly" });
    assert.equal(
      computePauseCreditAmount({
        packagePrice: 3100,
        paymentFrequency: "monthly",
        creditDays: 7,
      }),
      Math.round((3100 * 7) / monthlyPeriod.periodDays)
    );
    const quarterlyPeriod = computeBillingPeriod({
      paymentFrequency: "quarterly",
    });
    assert.equal(
      computePauseCreditAmount({
        packagePrice: 16000,
        paymentFrequency: "quarterly",
        creditDays: 14,
      }),
      Math.round((16000 * 14) / quarterlyPeriod.periodDays)
    );
    assert.equal(
      computePauseCreditAmount({
        packagePrice: 16000,
        paymentFrequency: "quarterly",
        creditDays: 0,
      }),
      0
    );
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

  it("tracks remaining pause days across split stays in one billing period", () => {
    assert.equal(pauseAllowanceDays("monthly", null, "2026-03-01"), 7);
    assert.equal(pauseAllowanceDays("quarterly", null, "2026-03-01"), 14);

    const first = resolvePauseBalance({
      paymentFrequency: "monthly",
      lastPaymentDate: "2026-03-01",
      pauseCreditDays: 3,
    });
    assert.equal(first.used, 3);
    assert.equal(first.remaining, 4);
    assert.equal(first.exhausted, false);

    const second = resolvePauseBalance({
      paymentFrequency: "monthly",
      lastPaymentDate: "2026-03-01",
      pauseCreditDays: 5,
    });
    assert.equal(second.used, 5);
    assert.equal(second.remaining, 2);

    const last = resolvePauseBalance({
      paymentFrequency: "monthly",
      lastPaymentDate: "2026-03-01",
      pauseCreditDays: 7,
    });
    assert.equal(last.remaining, 0);
    assert.equal(last.exhausted, true);
    assert.match(exhaustedPauseDaysMessage(last), /exhausted pause days/);
  });

  it("resets used pause days after the next subscription credits them", () => {
    const nextPeriod = resolvePauseBalance({
      paymentFrequency: "monthly",
      lastPaymentDate: "2026-04-01",
      pauseCreditDays: 7,
      pauseCreditAppliedAt: "2026-04-01T08:00:00.000Z",
    });
    assert.equal(nextPeriod.used, 0);
    assert.equal(nextPeriod.remaining, 7);
    assert.equal(nextPeriod.exhausted, false);
  });

  it("rejects a stay that is longer than remaining pause days", () => {
    assert.doesNotThrow(() =>
      assertPauseDurationAllowed({
        pauseStart: "2026-03-20",
        pauseEnd: "2026-03-23",
        paymentFrequency: "monthly",
        remainingDays: 4,
      })
    );
    assert.throws(
      () =>
        assertPauseDurationAllowed({
          pauseStart: "2026-03-20",
          pauseEnd: "2026-03-25",
          paymentFrequency: "monthly",
          remainingDays: 4,
        }),
      /4 pause days remaining/
    );
    assert.throws(
      () =>
        assertPauseDurationAllowed({
          pauseStart: "2026-03-20",
          pauseEnd: "2026-03-21",
          paymentFrequency: "monthly",
          remainingDays: 0,
        }),
      /exhausted pause days/
    );
  });
});

describe("open pause restore", () => {
  const openPause = {
    status: "active",
    subscriptionStatus: "Active",
    pauseStartDate: "2026-09-20",
    pauseEndDate: "2026-10-15",
    pauseCreditAppliedAt: null,
  };

  it("restores a dated pause that a TISP refresh cleared", () => {
    assert.equal(
      pauseStatusToRestore(openPause, [{ eventType: "pause", notes: "away" }], "2026-09-28"),
      "Paused"
    );
  });

  it("leaves an explicit resume active", () => {
    assert.equal(
      pauseStatusToRestore(
        openPause,
        [
          { eventType: "resume", notes: "Service resumed" },
          { eventType: "pause", notes: "away" },
        ],
        "2026-09-28"
      ),
      null
    );
  });

  it("does not restore after the return date", () => {
    assert.equal(
      pauseStatusToRestore(openPause, [{ eventType: "pause", notes: "away" }], "2026-10-16"),
      null
    );
  });

  it("restores an indefinite pause from the flag", () => {
    assert.equal(
      pauseStatusToRestore(
        {
          status: "active",
          subscriptionStatus: "Active",
          pauseIndefinite: true,
        },
        [{ eventType: "pause", notes: "Indefinite pause" }],
        "2026-09-28"
      ),
      "Paused Indefinitely"
    );
  });
});
