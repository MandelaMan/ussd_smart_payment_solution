/**
 * TISP SetClientDetails often returns HTTP 200 with a plain-text DB error.
 * parseTispOperationResponse must not treat those bodies as success.
 */
const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  parseTispOperationResponse,
} = require("../../api/controllers/tisp.controller");

describe("parseTispOperationResponse", () => {
  it("treats empty / blank bodies as success", () => {
    assert.equal(parseTispOperationResponse("").ok, true);
    assert.equal(parseTispOperationResponse(null).ok, true);
  });

  it("treats known validation messages as failure", () => {
    const parsed = parseTispOperationResponse("Package Missing.");
    assert.equal(parsed.ok, false);
    assert.match(parsed.message, /missing/i);
  });

  it("does not treat MySQL duplicate-key text as success", () => {
    const body =
      "Duplicate entry 'bedc8544-82e8-4863-b2b8-e182725bab64' for key 'client_account.PRIMARY'";
    const parsed = parseTispOperationResponse(body);
    assert.equal(parsed.ok, false);
    assert.match(parsed.message, /duplicate entry/i);
  });
});
