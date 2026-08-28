/**
 * TISP SetClientDetails often returns HTTP 200 with a plain-text DB error.
 * parseTispOperationResponse must not treat those bodies as success.
 */
const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  parseTispOperationResponse,
  isTispDuplicateAccountError,
  isTispAccountMissingError,
  tispClientPayloadIndicatesAccount,
  hasLocalTispAccountEvidence,
  shouldAllowTispCreateFallback,
  extractTispDuplicateAccountId,
  extractTispClientAccountId,
  stringifyTispCreatePayload,
  buildTispUpdateClientDetailsPayload,
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

describe("TISP account presence helpers", () => {
  it("treats Client Status payloads with due date (no status/package) as present", () => {
    assert.equal(
      tispClientPayloadIndicatesAccount({
        duedate: "21 Aug 2026 12:00 AM",
        AccountNumber: "ET-NG05",
      }),
      true
    );
  });

  it("does not treat a bare error message as a present account", () => {
    assert.equal(
      tispClientPayloadIndicatesAccount({ message: "Client not found" }),
      false
    );
  });

  it("uses synced status or due date as local TISP evidence", () => {
    assert.equal(hasLocalTispAccountEvidence({ tisp_sync_status: "synced" }), true);
    assert.equal(hasLocalTispAccountEvidence({ tispDueDate: "2026-09-01" }), true);
    assert.equal(hasLocalTispAccountEvidence({ tisp_sync_status: "failed" }), false);
  });

  it("never INSERTs on edit when the customer already has TISP evidence", () => {
    assert.equal(
      shouldAllowTispCreateFallback(
        { preferUpdate: true },
        { tisp_sync_status: "synced", tisp_due_date: "2026-09-01" }
      ),
      false
    );
    assert.equal(
      shouldAllowTispCreateFallback({ allowCreate: false }, {}),
      false
    );
  });

  it("still allows INSERT for first-time provision (no local TISP evidence)", () => {
    assert.equal(
      shouldAllowTispCreateFallback(
        { preferUpdate: true, allowCreate: true },
        { tisp_sync_status: "pending" }
      ),
      true
    );
  });

  it("does not treat package/router not-found as a missing TISP account", () => {
    assert.equal(isTispAccountMissingError("Package not found"), false);
    assert.equal(isTispAccountMissingError("Account not found"), true);
  });

  it("treats MySQL duplicate-key text as a duplicate account", () => {
    assert.equal(
      isTispDuplicateAccountError(
        "Duplicate entry 'bedc8544-82e8-4863-b2b8-e182725bab64' for key 'client_account.PRIMARY'"
      ),
      true
    );
  });
});

describe("TISP UPDATE identity", () => {
  it("extracts the client_account UUID from TISP's duplicate-key error", () => {
    assert.equal(
      extractTispDuplicateAccountId(
        "Duplicate entry '61754fdd-ace2-4c27-b3a0-a17f091dda1e' for key 'client_account.PRIMARY'"
      ),
      "61754fdd-ace2-4c27-b3a0-a17f091dda1e"
    );
  });

  it("puts snapshot Id on the UPDATE payload and wire JSON", () => {
    const payload = buildTispUpdateClientDetailsPayload({
      firstName: "Jane",
      lastName: "Doe",
      customerNumber: "ET-C201",
      planName: "Basic",
      categoryName: "Internet + Apartonet Channels",
      buildingName: "Enaki Towers",
      popName: "Enaki",
      ipSetup: "STATIC",
      ipAddress: "10.10.10.25",
      tispClientId: "61754fdd-ace2-4c27-b3a0-a17f091dda1e",
    });
    assert.equal(payload.TransactionType, "UPDATE");
    assert.equal(payload.Id, "61754fdd-ace2-4c27-b3a0-a17f091dda1e");
    const wire = stringifyTispCreatePayload(payload);
    assert.match(wire, /"Id":"61754fdd-ace2-4c27-b3a0-a17f091dda1e"/);
    assert.match(wire, /"TransactionType":"UPDATE", "PackageType"/);
  });

  it("reads Id from mixed snapshot key names", () => {
    assert.equal(
      extractTispClientAccountId({ tispClientId: "61754fdd-ace2-4c27-b3a0-a17f091dda1e" }),
      "61754fdd-ace2-4c27-b3a0-a17f091dda1e"
    );
  });
});
