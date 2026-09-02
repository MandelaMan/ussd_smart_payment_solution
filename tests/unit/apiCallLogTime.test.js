/**
 * API call logs keep the clock time of the attempt, not a calendar date.
 */
const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  formatLog,
  toIsoDateTime,
} = require("../../api/services/apiCallLogStore");

describe("api call log timestamps", () => {
  it("serializes Date created_at as ISO with clock time", () => {
    assert.equal(
      toIsoDateTime(new Date("2026-09-02T06:07:36.000Z")),
      "2026-09-02T06:07:36.000Z"
    );
  });

  it("treats naive MySQL DATETIME strings as UTC (mysql2 timezone Z)", () => {
    assert.equal(toIsoDateTime("2026-09-02 06:07:36"), "2026-09-02T06:07:36.000Z");
    assert.equal(toIsoDateTime("2026-09-02T06:07:36"), "2026-09-02T06:07:36.000Z");
  });

  it("keeps clock time on formatLog createdAt", () => {
    const log = formatLog({
      id: 9729,
      service: "tisp",
      operation: "set_package_create",
      method: "POST",
      endpoint: "SetPackageDetails",
      status: "failure",
      http_status: 400,
      request_payload: "{}",
      response_payload: null,
      error_message: "failed",
      customer_id: null,
      customer_number: null,
      reference_id: null,
      retryable: 1,
      retry_count: 0,
      parent_log_id: null,
      created_at: "2026-09-02 06:07:36",
    });
    assert.equal(log.createdAt, "2026-09-02T06:07:36.000Z");
  });
});
