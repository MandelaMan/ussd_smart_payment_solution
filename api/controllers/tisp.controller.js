const axios = require("axios");
const moment = require("moment-timezone");
require("dotenv").config();

const { logSetIspPaymentAttempt } = require("../utils/tispSetIspLogger");
const { logApiCall } = require("../utils/apiCallLogger");
const {
  ISP_PAYMENT_URL,
  TISP_SET_CLIENT_URL,
  TISP_CLIENT_STATUS_URL,
  TISP_SET_PACKAGE_URL,
} = require("../utils/tispUrls");

const SET_CLIENT_URL = TISP_SET_CLIENT_URL;
const SET_PACKAGE_URL = TISP_SET_PACKAGE_URL;

const TISP_REQUEST_TIMEOUT_MS = Number(
  process.env.TISP_REQUEST_TIMEOUT_MS || 15_000
);

/** TISP SetClientDetails only accepts "000000" (Postman reference payload). */
const TISP_DEFAULT_SHORTCODE = process.env.TISP_SHORTCODE || "000000";
const { DEFAULT_TZ } = require("../utils/billingPeriod");
const {
  TISP_STANDARD_DUE_DATE,
  TISP_BILLING_CYCLE,
  TISP_RELEASE_PLACEHOLDER_IP,
  TISP_PPOE_PLACEHOLDER_STATIC_IP,
} = require("../utils/tispConstants");
const {
  SKYNEST_PLACEHOLDER_PERSON_NAME,
  shouldUseAgencyContactForSkynestPlaceholder,
} = require("../utils/b2bBilling");

function tispOptionalString(value) {
  if (value == null) return "";
  return String(value);
}

/** TISP expects compact JSON: no space after colons or commas. */
function stringifyTispPayload(data) {
  if (typeof data === "string") {
    return data.replace(/":\s+/g, '":').replace(/,\s+/g, ",");
  }
  const normalized = {};
  for (const [key, value] of Object.entries(data || {})) {
    normalized[key] = value == null ? "" : value;
  }
  return JSON.stringify(normalized)
    .replace(/":\s+/g, '":')
    .replace(/,\s+/g, ",");
}

/** Exact field order for TISP INSERT (matches working Postman payload). */
const TISP_CREATE_FIELD_ORDER = [
  "TransactionType",
  "PackageType",
  "FirstName",
  "MiddleName",
  "LastName",
  "Telephone",
  "Email",
  "ContactPerson",
  "Location",
  "AccountNumber",
  "Package",
  "Router",
  "StaticIPAddress",
  "BillingCycle",
  "DueDate",
  "PppoeUsername",
  "PppoePassword",
  "PppoeRemoteAddress",
  "ShortCode",
  "AllowedPppoeDevices",
  "PackageIPPool",
];

function stringifyTispOrderedPayload(payload, fieldOrder) {
  const keys = fieldOrder.slice();
  // TISP UPDATE needs the existing row UUID; omit on INSERT.
  if (payload.Id) keys.unshift("Id");
  const parts = keys.map((key) => {
    const value = tispOptionalString(payload[key]);
    return `"${key}":${JSON.stringify(value)}`;
  });
  // Match TISP's own JSON (ClientStatus): no space after colon, space after comma.
  // Their Stream parser splits on comma-space; compact "," hid TransactionType=UPDATE
  // and SetClientDetails defaulted to INSERT (Duplicate entry on client_account.PRIMARY).
  return `{${parts.join(", ")}}`;
}

function stringifyTispCreatePayload(payload) {
  return stringifyTispOrderedPayload(payload, TISP_CREATE_FIELD_ORDER);
}

/**
 * Exact field order for TISP SetPackageDetails.
 * Optional keys stay in the body as "" (never omitted).
 */
const TISP_PACKAGE_FIELD_ORDER = [
  "TransactionType",
  "Package",
  "Router",
  "PackageType",
  "UploadSpeed",
  "DownloadSpeed",
  "Bandwidth",
  "Price",
  "PackageIPPool",
];

function stringifyTispPackagePayload(payload) {
  return stringifyTispOrderedPayload(payload, TISP_PACKAGE_FIELD_ORDER);
}

async function postTispJson(url, payload, { timeout = 30_000, wireFormat = "default" } = {}) {
  const body =
    wireFormat === "create"
      ? stringifyTispCreatePayload(payload)
      : wireFormat === "package"
        ? stringifyTispPackagePayload(payload)
        : stringifyTispPayload(payload);
  return axios.post(url, body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
    timeout,
    validateStatus: () => true,
    transformRequest: [],
  });
}

/**
 * POST payment notification to TISP SetISPPayment (M-Pesa success → ISP ledger).
 * @param {Record<string, string>} payload - TransactionType, TransID, TransTime, TransAmount, etc.
 */
async function postSetISPPayment(payload, meta = {}) {
  let httpStatus = null;
  let responseData = null;
  let logged = false;

  try {
    const r = await postTispJson(ISP_PAYMENT_URL, payload, { timeout: 20_000 });

    httpStatus = r.status;
    responseData = r.data;
    const ok = r.status >= 200 && r.status < 300;
    const parsed = parseTispOperationResponse(responseData);
    const success = ok && parsed.ok;

    await logSetIspPaymentAttempt({
      outcome: success ? "success" : "failure",
      httpStatus: r.status,
      url: ISP_PAYMENT_URL,
      request: payload,
      response: responseData,
      errorMessage: success ? null : parsed.message,
      customer_no: meta.customerNumber || payload.BillRefNumber,
      transactionId: meta.referenceId || payload.TransID,
      amount: meta.amount || payload.TransAmount,
      channel: meta.channel,
      checkoutRequestId: meta.checkoutRequestId,
    });
    logged = true;

    await logApiCall({
      service: "tisp",
      operation: "set_isp_payment",
      method: "POST",
      endpoint: ISP_PAYMENT_URL,
      status: success ? "success" : "failure",
      httpStatus: r.status,
      requestPayload: payload,
      responsePayload: responseData,
      errorMessage: success ? null : parsed.message,
      customerNumber: meta.customerNumber || payload.BillRefNumber || null,
      referenceId: meta.referenceId || payload.TransID || null,
      retryable: true,
      parentLogId: meta.parentLogId ?? null,
    });

    if (!success) {
      const err = new Error(
        parsed.message ||
          `SetISPPayment HTTP ${r.status}: ${JSON.stringify(responseData)}`,
      );
      err._setIspLogged = true;
      err._apiCallLogged = true;
      throw err;
    }

    return responseData;
  } catch (e) {
    if (!e._setIspLogged) {
      await logSetIspPaymentAttempt({
        outcome: "failure",
        httpStatus: e.response?.status ?? httpStatus,
        url: ISP_PAYMENT_URL,
        request: payload,
        response: e.response?.data ?? responseData,
        errorMessage: e.message,
        customer_no: meta.customerNumber || payload.BillRefNumber,
        transactionId: meta.referenceId || payload.TransID,
        amount: meta.amount || payload.TransAmount,
        channel: meta.channel,
        checkoutRequestId: meta.checkoutRequestId,
      });
    }
    if (!e._apiCallLogged) {
      await logApiCall({
        service: "tisp",
        operation: "set_isp_payment",
        method: "POST",
        endpoint: ISP_PAYMENT_URL,
        status: "failure",
        httpStatus: e.response?.status ?? httpStatus,
        requestPayload: payload,
        responsePayload: e.response?.data ?? responseData,
        errorMessage: e.message,
        customerNumber: meta.customerNumber || payload.BillRefNumber || null,
        referenceId: meta.referenceId || payload.TransID || null,
        retryable: true,
      });
    }
    throw e;
  }
}

async function callTISP(method = "POST", data = null, params = {}) {
  try {
    const config = {
      method,
      url: TISP_CLIENT_STATUS_URL,
      headers: {
        "Content-Type": "application/json",
      },
      params,
      timeout: TISP_REQUEST_TIMEOUT_MS,
    };

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error("TISP call failed:", error.message);
    throw error;
  }
}

function parseTispResponseBody(data) {
  if (data == null) return null;
  if (typeof data === "object" && !Array.isArray(data)) return { ...data };
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return { message: trimmed };
      }
    }
    return { message: trimmed };
  }
  return null;
}

function parseTispOperationResponse(data) {
  if (data == null || data === "") {
    return { ok: true, message: "" };
  }

  if (typeof data === "object" && !Array.isArray(data)) {
    const err =
      data.error ??
      data.Error ??
      data.message ??
      data.Message ??
      data.result ??
      data.Result;
    if (err != null && String(err).trim()) {
      const text = String(err).trim();
      return { ok: !isTispErrorText(text), message: text };
    }
    if (data.status && String(data.status).toUpperCase() === "ACTIVE") {
      return { ok: true, message: JSON.stringify(data) };
    }
    return { ok: true, message: JSON.stringify(data) };
  }

  const text = String(data).trim();
  if (!text) return { ok: true, message: "" };
  return { ok: !isTispErrorText(text), message: text };
}

function isTispErrorText(text) {
  const lower = String(text).toLowerCase();
  return (
    lower.includes("missing") ||
    lower.includes("not found") ||
    lower.includes("length cannot") ||
    lower.includes("parameter name") ||
    lower.includes("invalid") ||
    lower.includes("failed") ||
    lower.includes("error") ||
    // TISP often returns HTTP 200 with a MySQL body, e.g.
    // "Duplicate entry '…' for key 'client_account.PRIMARY'"
    lower.includes("duplicate") ||
    lower.includes("for key '") ||
    lower.includes("sqlstate") ||
    lower.includes("exception")
  );
}

function tispErrorMessage(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  return String(
    err.message ||
      err.response?.data?.message ||
      err.response?.data?.Message ||
      err.response?.data ||
      ""
  );
}

/** TISP INSERT rejected because AccountNumber already exists. */
function isTispDuplicateAccountError(err) {
  const lower = tispErrorMessage(err).toLowerCase();
  return (
    lower.includes("duplicate account") ||
    lower.includes("account already exists") ||
    lower.includes("already exist") ||
    lower.includes("duplicate entry")
  );
}

const TISP_RECORD_UUID_RE =
  /duplicate entry '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'/i;
const TISP_CLIENT_ACCOUNT_UUID_RE =
  /duplicate entry '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})' for key 'client_account\.primary'/i;

/** UUID TISP already has when INSERT hits a unique key. */
function extractTispDuplicateRecordId(err) {
  const match = tispErrorMessage(err).match(TISP_RECORD_UUID_RE);
  return match ? match[1] : "";
}

/** UUID TISP already has for this client when INSERT hits client_account.PRIMARY. */
function extractTispDuplicateAccountId(err) {
  const match = tispErrorMessage(err).match(TISP_CLIENT_ACCOUNT_UUID_RE);
  return match ? match[1] : extractTispDuplicateRecordId(err);
}

function extractTispClientAccountId(payload) {
  if (!payload || typeof payload !== "object") return "";
  const raw =
    payload.Id ??
    payload.id ??
    payload.tispClientId ??
    payload.ClientId ??
    payload.clientId ??
    payload.AccountId ??
    payload.accountId ??
    "";
  const value = String(raw).trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  )
    ? value
    : "";
}

/** TISP UPDATE / Client Status: account is not on TISP yet. */
function isTispAccountMissingError(err) {
  const lower = tispErrorMessage(err).toLowerCase();
  if (!lower) return false;
  // "package not found" / "router not found" are not a missing client.
  if (
    lower.includes("package") ||
    lower.includes("router") ||
    lower.includes("location")
  ) {
    return false;
  }
  return (
    lower.includes("account not found") ||
    lower.includes("client not found") ||
    lower.includes("no client") ||
    lower.includes("account does not exist") ||
    lower.includes("client does not exist") ||
    ((lower.includes("account") || lower.includes("client")) &&
      (lower.includes("not found") || lower.includes("does not exist")))
  );
}

/** SetClientDetails rejected because the Package name is not in TISP's catalog. */
function isTispPackageMissingError(err) {
  const lower = tispErrorMessage(err).toLowerCase();
  if (!lower || !lower.includes("package")) return false;
  return (
    lower.includes("package missing") ||
    lower.includes("package not found") ||
    lower.includes("unknown package") ||
    (lower.includes("package") && lower.includes("does not exist"))
  );
}

/**
 * Client Status body that means the account is present — even when `status` /
 * `package` are omitted (TISP often returns due date + names only).
 */
function tispClientPayloadIndicatesAccount(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }
  const candidates = [
    parsed.status,
    parsed.Status,
    parsed.package,
    parsed.Package,
    parsed.AccountNumber,
    parsed.accountNumber,
    parsed.accountnumber,
    parsed.DueDate,
    parsed.dueDate,
    parsed.duedate,
    parsed.StaticIPAddress,
    parsed.staticIPAddress,
    parsed.PppoeUsername,
    parsed.pppoeUsername,
    parsed.FirstName,
    parsed.firstName,
    parsed.Telephone,
    parsed.telephone,
  ];
  return candidates.some((value) => value != null && String(value).trim() !== "");
}

/** Local DB evidence that this customer already has a TISP account. */
function hasLocalTispAccountEvidence(ctx = {}) {
  const sync = String(ctx.tisp_sync_status || ctx.tispSyncStatus || "").toLowerCase();
  if (sync === "synced") return true;
  const due = ctx.tisp_due_date || ctx.tispDueDate;
  return Boolean(due && String(due).trim());
}

/**
 * Whether pushCustomerToTisp may INSERT after UPDATE looks missing.
 * Edits of already-provisioned customers must never create a second record.
 */
function shouldAllowTispCreateFallback(meta = {}, ctx = {}) {
  if (meta.allowCreate === false) return false;
  if (meta.forceUpdate === true) return false;
  if (meta.preferUpdate === true && hasLocalTispAccountEvidence(ctx)) {
    return false;
  }
  return true;
}

/**
 * Map TISP JSON keys to the shape USSD / callers expect (sample ET-F502 uses duedate, package, amount, status).
 */
function normalizeTispClientPayload(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }
  const dueDate =
    parsed.dueDate ??
    parsed.duedate ??
    parsed.DueDate ??
    parsed.DUE_DATE ??
    parsed.expiryDate ??
    parsed.ExpiryDate;

  return {
    ...parsed,
    dueDate: dueDate ?? parsed.dueDate,
    status: parsed.status ?? parsed.Status ?? parsed.STATUS,
    package: parsed.package ?? parsed.Package ?? parsed.PACKAGE,
    amount:
      parsed.amount ?? parsed.Amount ?? parsed.AMOUNT ?? parsed.monthlyAmount,
  };
}

async function accountExistsOnTisp(customerNumber) {
  try {
    const data = await callTISP("POST", {
      client: String(customerNumber ?? "").trim().toUpperCase(),
    });
    const parsed = parseTispResponseBody(data);
    if (!parsed) return false;
    // Identity fields first — a payload with DueDate/AccountNumber is present
    // even if `message` happens to match a generic error keyword.
    if (tispClientPayloadIndicatesAccount(parsed)) return true;
    if (parsed.message && isTispErrorText(parsed.message)) return false;
    return false;
  } catch {
    return false;
  }
}

const getTISPCustomer = async (clientNo) => {
  const client = String(clientNo ?? "").trim().toUpperCase();
  if (!client) {
    throw new Error("Client number is required.");
  }

  try {
    const data = await callTISP("POST", { client });
    const parsed = parseTispResponseBody(data);
    if (parsed?.message && isTispErrorText(parsed.message)) {
      throw new Error(parsed.message);
    }
    return normalizeTispClientPayload(parsed);
  } catch (error) {
    console.error("Failed to get TISP customer:", error.message);
    throw error;
  }
};

/**
 * Register or update a client on TISP (SetClientDetails).
 * Always forces BillingCycle to Monthly before send (create and update).
 */
async function postSetClientDetails(payload, meta = {}) {
  let httpStatus = null;
  let responseData = null;
  // Invariant: TISP renews monthly — never map dashboard payment frequency here.
  payload = { ...payload, BillingCycle: TISP_BILLING_CYCLE };
  const customerNumber =
    meta.customerNumber ??
    payload?.AccountNumber ??
    payload?.clientaccountnumber ??
    null;
  const packageLabel = String(payload?.Package ?? "").trim();

  if (!isValidTispPackageLabel(packageLabel)) {
    const errorMessage = packageLabel
      ? `Invalid TISP Package format "${packageLabel}" (expected e.g. "BASIC PLUS - INTERNET + APARTONET CHANNELS")`
      : 'Customer package is not on the catalog package list. Relink the customer to a current plan (Basic / Basic Plus / Premium / Premium Plus) before syncing to TISP.';
    await logApiCall({
      service: "tisp",
      operation: meta.operation || "set_client_details",
      method: "POST",
      endpoint: SET_CLIENT_URL,
      status: "failure",
      httpStatus: null,
      requestPayload: payload,
      responsePayload: null,
      errorMessage,
      customerId: meta.customerId ?? null,
      customerNumber,
      retryable: true,
      parentLogId: meta.parentLogId ?? null,
    });
    const err = new Error(errorMessage);
    err._apiCallLogged = true;
    throw err;
  }

  // Normalize PackageType in case a caller built the payload by hand.
  try {
    payload.PackageType = resolveTispPackageType(payload.PackageType || payload.packagetype);
  } catch (e) {
    const errorMessage = e.message || "Invalid TISP PackageType";
    await logApiCall({
      service: "tisp",
      operation: meta.operation || "set_client_details",
      method: "POST",
      endpoint: SET_CLIENT_URL,
      status: "failure",
      httpStatus: null,
      requestPayload: payload,
      responsePayload: null,
      errorMessage,
      customerId: meta.customerId ?? null,
      customerNumber,
      retryable: true,
      parentLogId: meta.parentLogId ?? null,
    });
    const err = new Error(errorMessage);
    err._apiCallLogged = true;
    throw err;
  }

  try {
    const r = await postTispJson(SET_CLIENT_URL, payload, {
      wireFormat:
        meta.operation === "set_client_create" ||
        meta.operation === "set_client_update"
          ? "create"
          : "default",
    });

    httpStatus = r.status;
    responseData = r.data;
    const httpOk = r.status >= 200 && r.status < 300;
    const parsed = parseTispOperationResponse(responseData);

    // Do not treat "account exists" as success when TISP returned an error
    // body (e.g. "Package Missing.") — the UPDATE did not apply.
    const success = httpOk && parsed.ok;

    await logApiCall({
      service: "tisp",
      operation: meta.operation || "set_client_details",
      method: "POST",
      endpoint: SET_CLIENT_URL,
      status: success ? "success" : "failure",
      httpStatus: r.status,
      requestPayload: payload,
      responsePayload: responseData,
      errorMessage: success ? null : parsed.message,
      customerId: meta.customerId ?? null,
      customerNumber,
      retryable: true,
      parentLogId: meta.parentLogId ?? null,
    });

    if (!success) {
      const err = new Error(
        parsed.message ||
          `SetClientDetails HTTP ${r.status}: ${JSON.stringify(responseData)}`,
      );
      err.response = r;
      err._apiCallLogged = true;
      const duplicateId = extractTispDuplicateAccountId(parsed.message);
      if (
        duplicateId &&
        !payload.Id &&
        meta._retriedWithClientAccountId !== true
      ) {
        // TISP looked up the existing row then INSERTed it. Retry as UPDATE with Id.
        const retried = await postSetClientDetails(
          { ...payload, Id: duplicateId, TransactionType: "UPDATE" },
          {
            ...meta,
            operation: "set_client_update",
            _retriedWithClientAccountId: true,
          }
        );
        if (meta.customerId) {
          try {
            const snapRepo = require("../repositories/integrationSnapshot.repository");
            const existing = await snapRepo.getTispSnapshot(meta.customerId);
            let raw = {};
            if (existing?.raw_json) {
              raw =
                typeof existing.raw_json === "string"
                  ? JSON.parse(existing.raw_json)
                  : existing.raw_json || {};
            }
            await snapRepo.upsertTispSnapshot(meta.customerId, {
              ...raw,
              Id: duplicateId,
            });
          } catch {
            /* best-effort — next edit can retry from the duplicate error again */
          }
        }
        return retried;
      }
      if (
        isTispPackageMissingError(parsed.message) &&
        meta._retriedAfterPackageCreate !== true &&
        packageLabel
      ) {
        try {
          await ensureTispPackage(
            {
              packageLabel,
              mbps: meta.packageMbps,
              extraBandwidth: meta.extraBandwidth,
              popName: meta.popName,
              price: meta.packagePrice,
              ipSetup: meta.ipSetup || payload.PackageType,
            },
            {
              parentLogId: meta.parentLogId ?? null,
              customerId: meta.customerId ?? null,
              customerNumber,
            }
          );
          return await postSetClientDetails(payload, {
            ...meta,
            _retriedAfterPackageCreate: true,
          });
        } catch {
          /* keep the original Package Missing error */
        }
      }
      throw err;
    }

    return responseData;
  } catch (e) {
    if (!e._apiCallLogged) {
      await logApiCall({
        service: "tisp",
        operation: meta.operation || "set_client_details",
        method: "POST",
        endpoint: SET_CLIENT_URL,
        status: "failure",
        httpStatus: e.response?.status ?? httpStatus,
        requestPayload: payload,
        responsePayload: e.response?.data ?? responseData,
        errorMessage: e.message,
        customerId: meta.customerId ?? null,
        customerNumber,
        retryable: true,
        parentLogId: meta.parentLogId ?? null,
      });
    }
    throw e;
  }
}

function formatTispError(err, responseData) {
  const fromResponse = err?.response?.data ?? responseData;
  const parsed = parseTispOperationResponse(fromResponse);
  if (!parsed.ok && parsed.message) return parsed.message;

  if (fromResponse != null) {
    if (typeof fromResponse === "string" && fromResponse.trim()) {
      return fromResponse.trim();
    }
    if (typeof fromResponse === "object") {
      const msg =
        fromResponse.error ??
        fromResponse.Error ??
        fromResponse.message ??
        fromResponse.Message ??
        fromResponse.result ??
        fromResponse.Result;
      if (msg != null && String(msg).trim()) return String(msg).trim();
      try {
        return JSON.stringify(fromResponse);
      } catch {
        return String(fromResponse);
      }
    }
  }
  return err?.message || "TISP SetClientDetails failed";
}

function tispNamePart(value) {
  const s = String(value ?? "").trim();
  return s || "-";
}

function formatTispDueDate(date = new Date()) {
  const formats = [
    "YYYY-MM-DD",
    "DD MMM YYYY hh:mm A",
    "DD MMM YYYY h:mm A",
    "DD-MMM-YYYY",
    "D-MMM-YYYY",
    moment.ISO_8601,
  ];
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) {
      return moment
        .tz(TISP_STANDARD_DUE_DATE, DEFAULT_TZ)
        .startOf("day")
        .format("DD MMM YYYY hh:mm A");
    }
    return moment.tz(date, DEFAULT_TZ).startOf("day").format("DD MMM YYYY hh:mm A");
  }

  const raw = String(date ?? "").trim();
  if (!raw) {
    return moment
      .tz(TISP_STANDARD_DUE_DATE, DEFAULT_TZ)
      .startOf("day")
      .format("DD MMM YYYY hh:mm A");
  }

  const parsed = moment.tz(raw, formats, true, DEFAULT_TZ);
  if (parsed.isValid()) {
    return parsed.startOf("day").format("DD MMM YYYY hh:mm A");
  }

  // Never silently fall back to "now" — that suspends customers on apartment moves.
  const loose = moment.tz(raw, DEFAULT_TZ);
  if (loose.isValid() && raw.length >= 8) {
    return loose.startOf("day").format("DD MMM YYYY hh:mm A");
  }

  console.warn(
    `[tisp] Unparseable DueDate "${raw}" — using TISP_STANDARD_DUE_DATE`
  );
  return moment
    .tz(TISP_STANDARD_DUE_DATE, DEFAULT_TZ)
    .startOf("day")
    .format("DD MMM YYYY hh:mm A");
}

function formatTispTelephone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

/** Always Monthly on TISP create/update — independent of dashboard payment frequency. */
function tispBillingCycle() {
  return TISP_BILLING_CYCLE;
}

/** TISP Location/Router catalogs are keyed by POP name, not building name. */
function tispRouterLocation(popName) {
  const location = String(popName ?? "").trim();
  if (!location) {
    throw new Error("POP name is required for TISP Router and Location");
  }
  return location.toUpperCase();
}

function tispPersonName(value) {
  return String(value ?? "").trim();
}

/**
 * Map building ip_setup → TISP SetClientDetails PackageType.
 * Wire values confirmed against successful api_call_logs: "IP" | "PPPOE".
 */
function resolveTispPackageType(ipSetup) {
  const raw = String(ipSetup ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  // Building enum is PPOE; TISP wire value is PPPOE. Accept either.
  if (raw === "PPOE" || raw === "PPPOE") return "PPPOE";
  if (raw === "STATIC" || raw === "IP") return "IP";
  if (!raw) {
    throw new Error(
      "Building IP setup is required for TISP PackageType (STATIC→IP, PPOE→PPPOE)"
    );
  }
  throw new Error(
    `Unsupported building IP setup "${ipSetup}" for TISP PackageType (expected STATIC or PPOE)`
  );
}

/**
 * TISP StaticIP / PppoeRemoteAddress differ by building IP setup:
 * - STATIC (PackageType IP): both fields are the assigned static IP
 * - PPOE (PackageType PPPOE): StaticIPAddress is 10.2.2.2; PppoeRemoteAddress is blank
 * Release to 0.0.0.0 is preserved so migrate can free the old account.
 */
function resolveTispNetworkFields(ipSetup, ipAddress) {
  const packageType = resolveTispPackageType(ipSetup);
  const incoming = String(ipAddress || "").trim();

  if (packageType === "PPPOE") {
    const staticIpAddress =
      incoming === TISP_RELEASE_PLACEHOLDER_IP
        ? TISP_RELEASE_PLACEHOLDER_IP
        : TISP_PPOE_PLACEHOLDER_STATIC_IP;
    return {
      packageType,
      staticIpAddress,
      pppoeRemoteAddress: "",
    };
  }

  return {
    packageType,
    staticIpAddress: incoming,
    pppoeRemoteAddress: incoming,
  };
}

/**
 * Normalize category segments for TISP Package field.
 * "Internet + Apartonet Channels" → "INTERNET + APARTONET CHANNELS"
 */
function formatTispCategorySegment(category) {
  return String(category || "")
    .split(/\s*\+\s*/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .join(" + ");
}

/**
 * TISP Package field for all POPs — strict `{PLAN} - {CATEGORY}` format.
 * Example: "BASIC PLUS - INTERNET + APARTONET CHANNELS"
 */
function buildTispPackageLabel({ planName, categoryName, productName }) {
  let plan = String(planName || "").trim();
  let category = String(categoryName || "").trim();

  if ((!plan || !category) && productName) {
    const parts = String(productName)
      .split(/\s*[·•―–—-]\s*|\s*\?\?\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!plan && parts.length >= 1) plan = parts[0];
    if (!category && parts.length >= 2) category = parts.slice(1).join(" + ");
  }

  const planUpper = plan.toUpperCase();
  const categorySegment = formatTispCategorySegment(category);

  if (planUpper && categorySegment) {
    return `${planUpper} - ${categorySegment}`;
  }

  return "";
}

/** True when Package matches catalog `{PLAN} - {CATEGORY}` format. */
function isValidTispPackageLabel(label) {
  return /^[A-Z0-9]+(?: [A-Z0-9]+)* - [A-Z0-9]+(?: [A-Z0-9]+)*(?: \+ [A-Z0-9]+(?: [A-Z0-9]+)*)*$/.test(
    String(label || "").trim()
  );
}

/** Always build from the admin package catalog — never legacy TISP names. */
function resolveTispPackageForWrite(input) {
  return buildTispPackageLabel(input);
}

function collectTispClientInput({
  firstName,
  middleName,
  lastName,
  buildingName,
  popName,
  customerNumber,
  customerType,
  ipSetup,
  planName,
  categoryName,
  productName,
  apartmentNumber,
  tispPassword,
  ipAddress,
  email,
  phone,
  isVatExempt,
  contactPerson,
  agencyName,
  agencyContactPerson,
}) {
  const packagetype = resolveTispPackageType(ipSetup);
  const hasIp = Boolean(ipAddress);
  const packageLabel = buildTispPackageLabel({
    planName,
    categoryName,
    productName,
  });

  return {
    packagetype,
    hasIp,
    billingcycle: tispBillingCycle(),
    packageLabel,
    shortCode: String(TISP_DEFAULT_SHORTCODE).trim(),
    firstName: tispNamePart(firstName),
    middleName: tispNamePart(middleName),
    lastName: tispNamePart(lastName),
    buildingName,
    popName,
    customerNumber,
    customerType,
    apartmentNumber,
    tispPassword,
    ipAddress: ipAddress || "",
    email: email || "",
    phone,
    isVatExempt,
    contactPerson: tispNamePart(contactPerson || agencyContactPerson || firstName),
    agencyName: agencyName || "",
  };
}

/**
 * TISP SetClientDetails payload — PascalCase fields (INSERT and UPDATE).
 */
function buildTispSetClientPayload(input, transactionType) {
  const {
    firstName,
    middleName,
    lastName,
    popName,
    customerNumber,
    ipSetup,
    planName,
    categoryName,
    productName,
    apartmentNumber,
    tispPassword,
    ipAddress,
    email,
    phone,
  } = input;

  const { packageType, staticIpAddress, pppoeRemoteAddress } =
    resolveTispNetworkFields(ipSetup, ipAddress);
  const keepSkynestPlaceholderNames =
    shouldUseAgencyContactForSkynestPlaceholder(input);
  const first = keepSkynestPlaceholderNames
    ? SKYNEST_PLACEHOLDER_PERSON_NAME
    : tispPersonName(firstName).toUpperCase();
  // TISP rejects blank MiddleName/LastName — send "-" when empty (not for Zoho).
  const middleRaw = tispPersonName(middleName);
  const lastRaw = tispPersonName(lastName);
  const middle = keepSkynestPlaceholderNames
    ? SKYNEST_PLACEHOLDER_PERSON_NAME
    : middleRaw || "-";
  const last = keepSkynestPlaceholderNames
    ? SKYNEST_PLACEHOLDER_PERSON_NAME
    : lastRaw
      ? lastRaw.toUpperCase()
      : "-";
  const routerLocation = tispRouterLocation(popName ?? input.pop_name);
  const packageLabel = buildTispPackageLabel({
    planName,
    categoryName,
    productName,
  });
  const id =
    String(transactionType || "").toUpperCase() === "UPDATE"
      ? extractTispClientAccountId(input)
      : "";

  return {
    ...(id ? { Id: id } : {}),
    TransactionType: transactionType,
    PackageType: packageType,
    FirstName: first,
    MiddleName: middle,
    LastName: last,
    Telephone: formatTispTelephone(phone),
    Email: email ? String(email).trim() : "",
    ContactPerson: tispPersonName(
      input.contactPerson || input.agencyContactPerson || first
    ).toUpperCase(),
    Location: routerLocation,
    AccountNumber: customerNumber,
    Package: packageLabel,
    Router: routerLocation,
    StaticIPAddress: staticIpAddress,
    BillingCycle: tispBillingCycle(),
    DueDate: formatTispDueDate(input.dueDate || TISP_STANDARD_DUE_DATE),
    PppoeUsername: String(
      input.ppoeUsername != null && String(input.ppoeUsername).trim() !== ""
        ? input.ppoeUsername
        : apartmentNumber || ""
    ),
    PppoePassword: String(tispPassword || ""),
    PppoeRemoteAddress: pppoeRemoteAddress,
    ShortCode: String(TISP_DEFAULT_SHORTCODE).trim(),
    AllowedPppoeDevices: "1",
    PackageIPPool: tispOptionalString(
      input.PackageIPPool ?? input.packageIpPool ?? input.packageIPPool
    ),
  };
}

/**
 * New customer registration on TISP (official INSERT payload — matches Postman).
 */
function buildTispCreateClientPayload(input) {
  return buildTispSetClientPayload(input, "INSERT");
}

/**
 * Update existing TISP client — same PascalCase payload as create, TransactionType UPDATE.
 */
function buildTispUpdateClientDetailsPayload(input) {
  return buildTispSetClientPayload(input, "UPDATE");
}

/** @deprecated Use buildTispCreateClientPayload or buildTispUpdateClientDetailsPayload */
function buildSetClientDetailsPayload(input) {
  return buildTispUpdateClientDetailsPayload(input);
}

function tispPackageMbps(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function tispPackageTotalMbps(input) {
  const base = tispPackageMbps(
    input?.mbps ?? input?.Bandwidth ?? input?.DownloadSpeed ?? input?.UploadSpeed
  );
  const extra = tispPackageMbps(
    input?.extraBandwidth ?? input?.extra_bandwidth ?? 0
  );
  return base + extra;
}

function tispPackageSpeedString(input) {
  const total = tispPackageTotalMbps(input);
  return total > 0 ? String(total) : "";
}

function tispPackagePrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(Math.round(n));
}

/**
 * PackageType from the building/POP ip_setup (STATIC→IP, PPOE→PPPOE).
 * Empty when no setup is known — never default to "IP".
 */
function tispPackageTypeFromInput(input) {
  const raw =
    input?.ipSetup ??
    input?.ip_setup ??
    input?.PackageType ??
    input?.packageType ??
    "";
  if (!String(raw).trim()) return "";
  return resolveTispPackageType(raw);
}

/**
 * TISP SetPackageDetails payload — PascalCase fields (INSERT and UPDATE).
 * Package must match the SetClientDetails Package label.
 * PackageType follows the building/POP IP setup (PPOE vs STATIC/IP).
 * UploadSpeed / DownloadSpeed are mandatory and equal Mbps + extra bandwidth.
 * Optional fields (Price, PackageIPPool, …) are always present as "".
 */
function buildTispSetPackagePayload(input, transactionType = "INSERT") {
  const packageLabel = String(
    input?.packageLabel || input?.Package || input?.package || ""
  ).trim();
  if (!isValidTispPackageLabel(packageLabel)) {
    throw new Error(
      packageLabel
        ? `Invalid TISP Package format "${packageLabel}" (expected e.g. "BASIC PLUS - INTERNET + APARTONET CHANNELS")`
        : "TISP package label is required"
    );
  }
  const speed = tispPackageSpeedString(input);
  if (!speed) {
    throw new Error(
      "TISP UploadSpeed and DownloadSpeed are required (package Mbps + extra bandwidth)"
    );
  }
  const popName = input?.popName ?? input?.pop_name ?? input?.Router;
  const router = popName ? tispRouterLocation(popName) : "";
  const id =
    String(transactionType || "").toUpperCase() === "UPDATE"
      ? extractTispClientAccountId(input)
      : "";
  return {
    ...(id ? { Id: id } : {}),
    TransactionType: String(transactionType || "INSERT").toUpperCase(),
    Package: packageLabel,
    Router: router,
    PackageType: tispPackageTypeFromInput(input),
    UploadSpeed: speed,
    DownloadSpeed: speed,
    Bandwidth: speed,
    Price: tispPackagePrice(input?.price ?? input?.Price),
    PackageIPPool: tispOptionalString(
      input?.PackageIPPool ?? input?.packageIpPool ?? input?.packageIPPool
    ),
  };
}

/**
 * Create or update a package on TISP (SetPackageDetails).
 */
async function postSetPackageDetails(payload, meta = {}) {
  let httpStatus = null;
  let responseData = null;
  const packageLabel = String(payload?.Package ?? "").trim();

  if (!isValidTispPackageLabel(packageLabel)) {
    const errorMessage = packageLabel
      ? `Invalid TISP Package format "${packageLabel}" (expected e.g. "BASIC PLUS - INTERNET + APARTONET CHANNELS")`
      : "TISP package label is required";
    await logApiCall({
      service: "tisp",
      operation: meta.operation || "set_package_details",
      method: "POST",
      endpoint: SET_PACKAGE_URL,
      status: "failure",
      httpStatus: null,
      requestPayload: payload,
      responsePayload: null,
      errorMessage,
      customerId: meta.customerId ?? null,
      customerNumber: meta.customerNumber ?? null,
      retryable: true,
      parentLogId: meta.parentLogId ?? null,
    });
    const err = new Error(errorMessage);
    err._apiCallLogged = true;
    throw err;
  }

  try {
    const r = await postTispJson(SET_PACKAGE_URL, payload, {
      wireFormat: "package",
    });

    httpStatus = r.status;
    responseData = r.data;
    const httpOk = r.status >= 200 && r.status < 300;
    const parsed = parseTispOperationResponse(responseData);
    const success = httpOk && parsed.ok;

    await logApiCall({
      service: "tisp",
      operation: meta.operation || "set_package_details",
      method: "POST",
      endpoint: SET_PACKAGE_URL,
      status: success ? "success" : "failure",
      httpStatus: r.status,
      requestPayload: payload,
      responsePayload: responseData,
      errorMessage: success ? null : parsed.message,
      customerId: meta.customerId ?? null,
      customerNumber: meta.customerNumber ?? null,
      retryable: true,
      parentLogId: meta.parentLogId ?? null,
    });

    if (!success) {
      const err = new Error(
        parsed.message ||
          `SetPackageDetails HTTP ${r.status}: ${JSON.stringify(responseData)}`
      );
      err.response = r;
      err._apiCallLogged = true;
      throw err;
    }

    return responseData;
  } catch (e) {
    if (!e._apiCallLogged) {
      await logApiCall({
        service: "tisp",
        operation: meta.operation || "set_package_details",
        method: "POST",
        endpoint: SET_PACKAGE_URL,
        status: "failure",
        httpStatus: e.response?.status ?? httpStatus,
        requestPayload: payload,
        responsePayload: e.response?.data ?? responseData,
        errorMessage: e.message,
        customerId: meta.customerId ?? null,
        customerNumber: meta.customerNumber ?? null,
        retryable: true,
        parentLogId: meta.parentLogId ?? null,
      });
    }
    throw e;
  }
}

/**
 * INSERT the catalog package on TISP; on duplicate retry as UPDATE.
 */
async function ensureTispPackage(input, meta = {}) {
  const createPayload = buildTispSetPackagePayload(input, "INSERT");
  try {
    return await postSetPackageDetails(createPayload, {
      ...meta,
      operation: "set_package_create",
    });
  } catch (err) {
    if (!isTispDuplicateAccountError(err)) throw err;
    const id = extractTispDuplicateRecordId(err);
    const updatePayload = {
      ...buildTispSetPackagePayload({ ...input, Id: id }, "UPDATE"),
    };
    return postSetPackageDetails(updatePayload, {
      ...meta,
      operation: "set_package_update",
    });
  }
}

function productLooksDstvOnly(product) {
  const { isDstvOnlyCategory } = require("../services/packageCatalogStore");
  return isDstvOnlyCategory(
    product?.categoryCode || product?.category_code || product?.categoryName
  );
}

/**
 * Push a local building product's catalog label to TISP (not per-building price).
 * Soft callers should catch — local package save stays source of truth.
 */
async function syncProductToTisp(product, meta = {}) {
  if (!product || productLooksDstvOnly(product)) {
    return { ok: true, skipped: true, reason: "dstv_only" };
  }
  const packageLabel = buildTispPackageLabel({
    planName: product.planName || product.plan_name,
    categoryName: product.categoryName || product.category_name,
    productName: product.name,
  });
  if (!packageLabel) {
    return { ok: true, skipped: true, reason: "no_catalog_label" };
  }
  await ensureTispPackage(
    {
      packageLabel,
      mbps: product.mbps ?? product.product_mbps,
      extraBandwidth:
        product.extraBandwidth ?? product.extra_bandwidth ?? 0,
      popName: product.popName || product.pop_name,
      price: product.monthlyPrice ?? product.monthly_price ?? 0,
      ipSetup: product.ipSetup || product.ip_setup,
    },
    meta
  );
  return { ok: true, packageLabel };
}

async function syncProductToTispSafe(product, meta = {}) {
  try {
    return await syncProductToTisp(product, meta);
  } catch (err) {
    console.warn("TISP SetPackageDetails failed:", err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Upsert every internet catalog package (plan × category) onto TISP.
 * DSTV-only is skipped — those customers are not provisioned on TISP.
 */
async function syncCatalogPackagesToTisp(meta = {}) {
  const catalogStore = require("../services/packageCatalogStore");
  const { listPops } = require("../services/customerModuleStore");
  const catalog = await catalogStore.listPackageCatalog();
  const { pops } = await listPops();
  const popTargets = [];
  const seenPops = new Set();
  for (const pop of pops || []) {
    const popName = String(pop.name || pop.popName || "").trim();
    if (!popName || seenPops.has(popName)) continue;
    seenPops.add(popName);
    popTargets.push({
      popName,
      ipSetup: pop.ipSetup || pop.ip_setup || "",
    });
  }
  const results = [];
  const seen = new Set();

  for (const category of catalog || []) {
    if (catalogStore.isDstvOnlyCategory(category.code)) continue;
    for (const plan of category.plans || []) {
      const monthly = (plan.variants || []).find(
        (v) => v.paymentFrequency === "monthly"
      );
      const packageLabel = buildTispPackageLabel({
        planName: plan.name,
        categoryName: category.name,
      });
      if (!packageLabel) continue;
      const targets = popTargets.length
        ? popTargets
        : [{ popName: "", ipSetup: "" }];
      for (const { popName, ipSetup } of targets) {
        const key = `${packageLabel}::${popName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          await ensureTispPackage(
            {
              packageLabel,
              mbps: monthly ? Number(monthly.defaultMbps) : 0,
              popName,
              ipSetup,
            },
            meta
          );
          results.push({ packageLabel, popName, ok: true });
        } catch (err) {
          results.push({
            packageLabel,
            popName,
            ok: false,
            error: err.message,
          });
        }
      }
    }
  }

  return results;
}

const test = async (req, res) => {
  const { customer_no } = req.body;

  const result = await getTISPCustomer(customer_no);

  res.json(result);
};

module.exports = {
  getTISPCustomer,
  postSetISPPayment,
  postSetClientDetails,
  postSetPackageDetails,
  buildTispCreateClientPayload,
  buildTispUpdateClientDetailsPayload,
  buildSetClientDetailsPayload,
  buildTispSetPackagePayload,
  buildTispPackageLabel,
  resolveTispPackageType,
  resolveTispNetworkFields,
  resolveTispPackageForWrite,
  isValidTispPackageLabel,
  stringifyTispPayload,
  stringifyTispCreatePayload,
  stringifyTispPackagePayload,
  formatTispError,
  parseTispOperationResponse,
  accountExistsOnTisp,
  tispClientPayloadIndicatesAccount,
  hasLocalTispAccountEvidence,
  shouldAllowTispCreateFallback,
  isTispDuplicateAccountError,
  extractTispDuplicateAccountId,
  extractTispDuplicateRecordId,
  extractTispClientAccountId,
  isTispAccountMissingError,
  isTispPackageMissingError,
  ensureTispPackage,
  syncProductToTisp,
  syncProductToTispSafe,
  syncCatalogPackagesToTisp,
  formatTispDueDate,
  test,
  TISP_STANDARD_DUE_DATE,
  TISP_BILLING_CYCLE,
  TISP_PACKAGE_FIELD_ORDER,
};
