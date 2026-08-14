const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  parseInstallationInput,
  formatInstallationDisplay,
} = require("../../api/services/installationStore");

describe("installation schedule parsing", () => {
  it("combines date and time", () => {
    const parsed = parseInstallationInput({
      installationDate: "2026-08-14",
      installationTime: "09:30",
      installationAssignmentMode: "manual",
    });
    assert.equal(parsed.scheduledAt, "2026-08-14 09:30:00");
    assert.equal(parsed.assignmentMode, "manual");
  });

  it("allows an empty slot", () => {
    const parsed = parseInstallationInput({});
    assert.equal(parsed.scheduledAt, null);
    assert.equal(parsed.assignmentMode, "auto");
  });

  it("requires a slot when required is set", () => {
    assert.throws(
      () => parseInstallationInput({}, { required: true }),
      /Installation date and time are required/
    );
  });

  it("formats wall-clock datetime for emails", () => {
    const display = formatInstallationDisplay("2026-08-14 09:30:00");
    assert.equal(display.date, "14 Aug 2026");
    assert.match(display.time, /9:30/);
    assert.match(display.dateTime, /14 Aug 2026/);
  });
});
