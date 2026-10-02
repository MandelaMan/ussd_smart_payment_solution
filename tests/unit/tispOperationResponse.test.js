/**
 * TISP SetClientDetails often returns HTTP 200 with a plain-text DB error.
 * parseTispOperationResponse must not treat those bodies as success.
 */
const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  summarizeTispFaultMessage,
  isTransientTispFault,
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
  explainTispSetClientError,
  isTispUpdateImplementedAsInsertError,
  extractTispLivePackageName,
} = require("../../api/controllers/tisp.controller");

describe("summarizeTispFaultMessage", () => {
  it("extracts the exception from a WCF HTML fault page", () => {
    const html = `<?xml version="1.0" encoding="utf-8"?> <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"> <html><head><title>Request Error</title><style>BODY { color: #000; }</style></head><body><p class="heading1">Request Error</p><p>The server encountered an error processing the request. The exception message is 'Object reference not set to an instance of an object.'. See server logs for more details. The exception stack trace is: </p><p> at System.Data.RBTree\`1.Successor</p></body></html>`;
    assert.equal(
      summarizeTispFaultMessage(html),
      "Request failed: Object reference not set to an instance of an object."
    );
  });

  it("leaves short plain-text TISP errors unchanged", () => {
    assert.equal(summarizeTispFaultMessage("Package Missing."), "Package Missing.");
  });
});

describe("isTransientTispFault", () => {
  it("flags ClientStatus fault pages as retryable", () => {
    assert.equal(
      isTransientTispFault(
        "<html><body><p>Request Error</p><p>The exception message is 'Object reference not set to an instance of an object.'.</p></body></html>"
      ),
      true
    );
  });

  it("does not flag real TISP validation messages", () => {
    assert.equal(isTransientTispFault("Client not found"), false);
    assert.equal(isTransientTispFault("Package Missing."), false);
    assert.equal(isTransientTispFault(""), false);
  });
});

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

  it("INSERTs on edit when TISP says the account does not exist", () => {
    assert.equal(
      shouldAllowTispCreateFallback(
        { preferUpdate: true, allowCreate: false },
        { tisp_sync_status: "synced", tisp_due_date: "2026-09-01" },
        "Account does not exist"
      ),
      true
    );
    assert.equal(
      shouldAllowTispCreateFallback(
        { preferUpdate: true },
        { tisp_sync_status: "synced" },
        new Error("Client not found")
      ),
      true
    );
    assert.equal(
      shouldAllowTispCreateFallback(
        { forceUpdate: true },
        {},
        "Account does not exist"
      ),
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

  it("does not send snapshot Id on SetClientDetails UPDATE", () => {
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
    assert.equal(payload.Id, undefined);
    const wire = stringifyTispCreatePayload(payload);
    assert.match(wire, /^\{"TransactionType":"UPDATE","PackageType"/);
    assert.doesNotMatch(wire, /": /);
    assert.doesNotMatch(wire, /"Id":/);
    assert.doesNotMatch(wire, /PackageIPPool/);
  });

  it("explains UPDATE colliding on client_account.PRIMARY", () => {
    const payload = { TransactionType: "UPDATE", AccountNumber: "ET-H302" };
    const msg =
      "Duplicate entry 'c72862a8-6ae8-4f34-82ed-4a4fd5f7561d' for key 'client_account.PRIMARY'";
    assert.equal(isTispUpdateImplementedAsInsertError(payload, msg), true);
    assert.equal(isTispUpdateImplementedAsInsertError({ TransactionType: "INSERT" }, msg), false);
    assert.match(explainTispSetClientError(payload, msg), /ET-H302/);
    assert.match(explainTispSetClientError(payload, msg), /c72862a8-6ae8-4f34-82ed-4a4fd5f7561d/);
    assert.match(explainTispSetClientError(payload, msg), /inserted that client_account row/i);
  });

  it("keeps TransactionType first on UPDATE when no snapshot Id is present", () => {
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
    });
    const wire = stringifyTispCreatePayload(payload);
    assert.match(wire, /^\{"TransactionType":"UPDATE","PackageType"/);
    assert.doesNotMatch(wire, /"Id":/);
  });

  it("reads live TISP package from Client Status payloads", () => {
    assert.equal(
      extractTispLivePackageName({
        package: "BASIC PLUS - INTERNET + DSTV CHANNELS + APARTONET CHANNELS",
      }),
      "BASIC PLUS - INTERNET + DSTV CHANNELS + APARTONET CHANNELS"
    );
  });

  it("reads Id from mixed snapshot key names", () => {
    assert.equal(
      extractTispClientAccountId({ tispClientId: "61754fdd-ace2-4c27-b3a0-a17f091dda1e" }),
      "61754fdd-ace2-4c27-b3a0-a17f091dda1e"
    );
  });
});
