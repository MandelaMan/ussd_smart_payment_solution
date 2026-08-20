const axios = require("axios");
const https = require("https");
const moment = require("moment");
const LRU = require("lru-cache");
const { logApiCall } = require("../utils/apiCallLogger");
const {
  pickDepositAccountId,
  mpesaDepositLookupOptions,
} = require("../utils/zohoDepositAccount");
require("dotenv").config();

/** ========= Config ========= **/
const ZOHO_AUTH_URL =
  process.env.ZOHO_AUTH_URL || "https://accounts.zoho.com/oauth/v2/token";
const ZOHO_BASE_URL = process.env.ZOHO_BASE_URL; // e.g. https://books.zoho.com/api/v3
const ZOHO_ORG_ID = process.env.ZOHO_ORG_ID;
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_PAYMENT_MODE = process.env.ZOHO_PAYMENT_MODE || "Mobile Money";

if (!ZOHO_BASE_URL || !ZOHO_ORG_ID) {
  console.warn("[zoho] Missing ZOHO_BASE_URL or ZOHO_ORG_ID");
}

/** ========= Token cache (avoid refresh per call) ========= **/
let cachedToken = null;
let tokenExpiresAt = 0;
let refreshingPromise = null;

// Refresh token once; callers await the same promise
async function refreshAccessToken() {
  const params = {
    refresh_token: ZOHO_REFRESH_TOKEN,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    grant_type: "refresh_token",
  };

  const { data } = await axios.post(ZOHO_AUTH_URL, null, {
    params,
    timeout: 8000,
  });
  // Zoho typically returns expires_in ~ 3600
  const ttlSec = Number(data.expires_in || 3600);
  cachedToken = data.access_token;
  // Renew a little earlier to avoid race; 55 minutes default
  tokenExpiresAt = Date.now() + Math.max(30_000, (ttlSec - 300) * 1000);
  return cachedToken;
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) return cachedToken;
  if (!refreshingPromise) {
    refreshingPromise = refreshAccessToken().finally(() => {
      refreshingPromise = null;
    });
  }
  return refreshingPromise;
}

/** ========= Axios client with keep-alive + retries ========= **/
const agent = new https.Agent({ keepAlive: true, maxSockets: 50 });
const zoho = axios.create({
  baseURL: ZOHO_BASE_URL,
  timeout: 10_000,
  httpsAgent: agent,
  headers: { Accept: "application/json" },
});

function deriveZohoOperation(url = "", method = "GET") {
  const path = String(url).replace(/^\//, "");
  const verb = String(method || "GET").toLowerCase();
  const parts = path.split("/").filter(Boolean);
  const resource = parts[0] || "api";
  if (parts.length <= 1) return `${verb}_${resource}`;
  return `${verb}_${parts.join("_")}`.slice(0, 100);
}

function buildZohoEndpoint(url = "") {
  const path = String(url).startsWith("/") ? url : `/${url}`;
  return `${ZOHO_BASE_URL || ""}${path}`;
}

function clipPayload(value, maxLen = 12000) {
  if (value == null) return null;
  try {
    const json = JSON.stringify(value);
    if (json.length <= maxLen) return value;
    return { _truncated: true, preview: json.slice(0, maxLen) };
  } catch {
    return { _error: "unserializable" };
  }
}

function extractZohoLogContext(config = {}) {
  const meta = config.__logMeta || {};
  const data = config.data;
  const parsedData =
    typeof data === "string"
      ? (() => {
          try {
            return JSON.parse(data);
          } catch {
            return {};
          }
        })()
      : data && typeof data === "object"
        ? data
        : {};

  const referenceId =
    meta.referenceId ||
    parsedData.reference_number ||
    parsedData.invoice_id ||
    parsedData.payment_id ||
    parsedData.customer_id ||
    parsedData.contact_id ||
    config.params?.invoice_id ||
    config.params?.customer_id ||
    null;

  return {
    customerNumber: meta.customerNumber || parsedData.customer_number || null,
    customerId: meta.customerId || null,
    referenceId: referenceId != null ? String(referenceId) : null,
  };
}

async function persistZohoApiLog(config, { response, error } = {}) {
  if (!config || config.__skipApiLog) return;
  const httpStatus = response?.status ?? error?.response?.status ?? null;
  const success = response != null && httpStatus >= 200 && httpStatus < 300;
  const ctx = extractZohoLogContext(config);

  await logApiCall({
    service: "zoho",
    operation: deriveZohoOperation(config.url, config.method),
    method: String(config.method || "GET").toUpperCase(),
    endpoint: buildZohoEndpoint(config.url),
    status: success ? "success" : "failure",
    httpStatus,
    requestPayload: clipPayload({
      params: config.params,
      data: config.data,
    }),
    responsePayload: clipPayload(
      success ? response?.data : (error?.response?.data ?? null),
    ),
    errorMessage: success
      ? null
      : error?.response?.data?.message ||
        error?.message ||
        (httpStatus ? `HTTP ${httpStatus}` : "Request failed"),
    customerId: ctx.customerId,
    customerNumber: ctx.customerNumber,
    referenceId: ctx.referenceId,
    retryable:
      !success &&
      (httpStatus == null || httpStatus >= 500 || httpStatus === 429),
    parentLogId: config.__parentLogId ?? null,
  });
}

// Attach token per request; enforce daily API budget (Zoho Books: 10k/day)
zoho.interceptors.request.use(async (config) => {
  const { getZohoCallPriority } = require("../lib/zohoCallContext");
  const { assertCanMakeZohoCall } = require("../lib/zohoApiBudget");
  const priority = config.__zohoPriority || getZohoCallPriority();
  await assertCanMakeZohoCall(priority, 1);
  const token = await getAccessToken();
  config.headers.Authorization = `Zoho-oauthtoken ${token}`;
  config.params = { ...(config.params || {}), organization_id: ZOHO_ORG_ID };
  return config;
});

// Simple retry with exponential backoff + jitter; honors Retry-After
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
zoho.interceptors.response.use(
  async (res) => {
    const { recordZohoApiCall } = require("../lib/zohoApiBudget");
    const { recordZohoApiUsage } = require("../lib/zohoApiUsage");
    const { getZohoCallPriority } = require("../lib/zohoCallContext");
    recordZohoApiCall(1).catch(() => {});
    const priority = getZohoCallPriority();
    recordZohoApiUsage({
      module: priority === "interactive" ? "interactive" : "scheduled",
      source: priority,
      count: 1,
    }).catch(() => {});
    persistZohoApiLog(res.config, { response: res }).catch(() => {});
    return res;
  },
  async (error) => {
    const cfg = error.config || {};
    cfg.__retryCount = cfg.__retryCount || 0;

    const status = error.response?.status;
    const retryable =
      !cfg.__noRetry &&
      (status === 429 ||
        (status >= 500 && status < 600) ||
        error.code === "ECONNRESET" ||
        error.code === "ETIMEDOUT");

    if (retryable && cfg.__retryCount < 3) {
      cfg.__retryCount += 1;

      let backoff = Math.min(1000 * 2 ** (cfg.__retryCount - 1), 6000);
      const retryAfter = error.response?.headers?.["retry-after"];
      if (retryAfter) {
        const raMs = Number(retryAfter) * 1000;
        if (!Number.isNaN(raMs)) backoff = Math.max(backoff, raMs);
      }
      // jitter
      backoff += Math.floor(Math.random() * 250);
      await sleep(backoff);
      return zoho(cfg);
    }

    // If token might be expired and we haven't retried via interceptor, try a one-shot refresh
    if (status === 401 && !cfg.__refreshed) {
      cfg.__refreshed = true;
      cachedToken = null;
      await getAccessToken(); // refresh
      return zoho(cfg);
    }

    persistZohoApiLog(cfg, { error }).catch(() => {});
    return Promise.reject(error);
  },
);

const {
  looksLikeCustomerNumber,
  looksLikePhoneKey,
  phonesMatch,
  normalizePhoneDigits,
  normalizeCustomerRef,
  zohoContactMatchesDashboardCustomer,
  zohoContactMatchesCustomerIdentity,
  filterZohoInvoicesForContact,
  filterZohoPaymentsForContact,
} = require("../utils/zohoCustomerScope");
const withTimeout = (promise, ms, label = "op") =>
  Promise.race([
    promise,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);

async function callZoho(
  endpoint,
  method = "GET",
  data = null,
  extraParams = {},
) {
  const cfg = { url: `/${endpoint}`, method, params: extraParams };
  if (data) cfg.data = data;
  const { data: body } = await zoho(cfg);
  return body;
}

// Normalize + scoring for best local match
const norm = (s = "") => s.trim().toLowerCase();
const scoreMatch = (q, c) => {
  const qn = norm(q);
  const fields = [
    c.company_name,
    c.contact_name,
    c.customer_name,
    c.vendor_name,
    c.email,
  ]
    .filter(Boolean)
    .map(norm);
  if (fields.includes(qn)) return 100;
  if (fields.some((f) => f.startsWith(qn))) return 70;
  if (fields.some((f) => f.includes(qn))) return 50;
  return 0;
};

// Keep responses lean (customize as needed)
const pickLean = (c) => {
  if (!c) return c;
  const {
    contact_id,
    contact_name,
    customer_name,
    company_name,
    email,
    mobile,
    phone,
    status,
    currency_code,
    outstanding_receivable_amount,
  } = c;
  return {
    contact_id,
    contact_name,
    customer_name,
    company_name,
    email,
    mobile,
    phone,
    status,
    currency_code,
    outstanding_receivable_amount,
  };
};

/** ========= Small LRU cache for hot lookups ========= **/
const CONTACT_CACHE_TTL_MS = Number(process.env.ZOHO_CONTACT_CACHE_TTL_MS || 30 * 60 * 1000);
const cache = new LRU({ max: 500, ttl: CONTACT_CACHE_TTL_MS });

/** Drop cached company/name lookups after rename / retire so the live number is free. */
function invalidateZohoContactLookupCache(companyName) {
  const raw = String(companyName || "").trim();
  if (!raw) return;
  cache.delete(`cust:company:${norm(raw)}`);
  cache.delete(norm(raw));
}

/** ========= Core JS functions (no req/res, return raw data) ========= **/

// Get invoices (array)
const getInvoices_JS = async (params = {}) => {
  try {
    const page = Number(params.page || 1);
    const per_page = Math.min(Number(params.per_page || 50), 200);
    const customer_id = params.customer_id;
    const zohoParams = { ...params, page, per_page };

    const data = await withTimeout(
      callZoho("invoices", "GET", null, zohoParams),
      10_000,
      "get-invoices",
    );

    const invoices = data.invoices || [];
    if (!customer_id) return invoices;
    return filterZohoInvoicesForContact(invoices, customer_id);
  } catch (error) {
    console.error(
      "getInvoices_JS error:",
      error.response?.data || error.message,
    );
    return [];
  }
};

// Get recurring invoices for a customer (array)
const getRecurringInvoices_JS = async (params = {}) => {
  try {
    const customer_id = params.customer_id;
    if (!customer_id) return [];

    const page = Number(params.page || 1);
    const per_page = Math.min(Number(params.per_page || 50), 200);
    const zohoParams = { customer_id, page, per_page };

    const data = await withTimeout(
      callZoho("recurringinvoices", "GET", null, zohoParams),
      10_000,
      "get-recurring-invoices",
    );

    return data.recurringinvoices || data.recurring_invoices || [];
  } catch (error) {
    console.error(
      "getRecurringInvoices_JS error:",
      error.response?.data || error.message,
    );
    return [];
  }
};

const getRecurringInvoice_JS = async (recurringInvoiceId) => {
  if (!recurringInvoiceId) return null;
  try {
    const data = await withTimeout(
      callZoho(`recurringinvoices/${recurringInvoiceId}`, "GET"),
      10_000,
      "get-recurring-invoice",
    );
    return data.recurring_invoice || data.recurringinvoice || data;
  } catch (error) {
    console.error(
      "getRecurringInvoice_JS error:",
      error.response?.data || error.message,
    );
    return null;
  }
};

// Resume a stopped recurring invoice
const resumeRecurringInvoice_JS = async (recurringInvoiceId) => {
  if (!recurringInvoiceId) return null;
  try {
    const data = await withTimeout(
      callZoho(
        `recurringinvoices/${recurringInvoiceId}/status/resume`,
        "POST",
        {},
      ),
      10_000,
      "resume-recurring-invoice",
    );
    return data.recurringinvoice || data;
  } catch (error) {
    console.error(
      "resumeRecurringInvoice_JS error:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

const stopRecurringInvoice_JS = async (recurringInvoiceId) => {
  if (!recurringInvoiceId) return null;
  try {
    const data = await withTimeout(
      callZoho(
        `recurringinvoices/${recurringInvoiceId}/status/stop`,
        "POST",
        {},
      ),
      10_000,
      "stop-recurring-invoice",
    );
    return data.recurringinvoice || data.recurring_invoice || data;
  } catch (error) {
    console.error(
      "stopRecurringInvoice_JS error:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

/** Mark a Zoho Books contact inactive (POST /contacts/{id}/inactive). */
const markContactInactive_JS = async (contactId) => {
  if (!contactId) return null;
  try {
    const data = await withTimeout(
      callZoho(`contacts/${contactId}/inactive`, "POST", {}),
      12_000,
      "mark-contact-inactive",
    );
    return data.contact || data;
  } catch (error) {
    console.error(
      "markContactInactive_JS error:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

/** Mark a Zoho Books contact active (POST /contacts/{id}/active). */
const markContactActive_JS = async (contactId) => {
  if (!contactId) return null;
  try {
    const data = await withTimeout(
      callZoho(`contacts/${contactId}/active`, "POST", {}),
      12_000,
      "mark-contact-active",
    );
    return data.contact || data;
  } catch (error) {
    console.error(
      "markContactActive_JS error:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

/** Include inactive contacts in list/search (Zoho defaults to active-only). */
const ZOHO_CONTACT_LIST_FILTER = { filter_by: "Status.All" };

function isZohoContactInactive(contact) {
  return String(contact?.status || "").trim().toLowerCase() === "inactive";
}

/** Prefer active matches when ranking search hits. */
function rankContactMatches(query, list) {
  return (list || [])
    .map((c) => ({
      c,
      s: scoreMatch(query, c) + (isZohoContactInactive(c) ? 0 : 5),
    }))
    .filter((x) => scoreMatch(query, x.c) > 0)
    .sort((a, b) => b.s - a.s);
}

const createRecurringInvoice_JS = async ({
  customer_id,
  recurrence_name,
  reference_number,
  start_date,
  recurrence_frequency,
  repeat_every,
  line_items,
  is_inclusive_tax,
  payment_terms,
  payment_terms_label,
  billing_address,
  customer,
}) => {
  if (!customer_id || !line_items?.length) return null;
  const { buildZohoBillingAddress } = require("../utils/zohoBillingAddress");
  const resolvedBilling =
    billing_address ||
    (customer ? buildZohoBillingAddress(customer) : null);

  const payload = {
    customer_id,
    recurrence_name,
    reference_number,
    start_date,
    recurrence_frequency,
    repeat_every,
    line_items,
  };
  if (is_inclusive_tax != null) {
    payload.is_inclusive_tax = Boolean(is_inclusive_tax);
  }
  if (payment_terms != null && Number(payment_terms) >= 0) {
    payload.payment_terms = Number(payment_terms);
  }
  if (payment_terms_label) {
    payload.payment_terms_label = String(payment_terms_label);
  }
  if (resolvedBilling) {
    payload.billing_address = resolvedBilling;
  }

  const createResult = await withTimeout(
    callZoho("recurringinvoices", "POST", payload),
    12_000,
    "create-recurring-invoice",
  );
  return (
    createResult.recurring_invoice ||
    createResult.recurringinvoice ||
    createResult
  );
};

const updateRecurringInvoice_JS = async (recurringInvoiceId, payload) => {
  if (!recurringInvoiceId) return null;
  try {
    const data = await withTimeout(
      callZoho(`recurringinvoices/${recurringInvoiceId}`, "PUT", payload),
      12_000,
      "update-recurring-invoice",
    );
    return data.recurring_invoice || data.recurringinvoice || data;
  } catch (error) {
    console.error(
      "updateRecurringInvoice_JS error:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

// Get customer payments (array)
const getCustomerPayments_JS = async (params = {}) => {
  try {
    const customer_id = params.customer_id;
    if (!customer_id) return [];

    const page = Number(params.page || 1);
    const per_page = Math.min(Number(params.per_page || 50), 200);
    const zohoParams = {
      customer_id,
      page,
      per_page,
      sort_column: "date",
      sort_order: "D",
    };

    const data = await withTimeout(
      callZoho("customerpayments", "GET", null, zohoParams),
      10_000,
      "get-customer-payments",
    );

    const payments = data.customerpayments || data.payments || [];
    return filterZohoPaymentsForContact(payments, customer_id);
  } catch (error) {
    console.error(
      "getCustomerPayments_JS error:",
      error.response?.data || error.message,
    );
    return [];
  }
};

/**
 * Find a Zoho customer payment by REFERENCE# (Received Payments → Reference).
 * Searches org-wide (not limited to one contact).
 */
const findCustomerPaymentByReference_JS = async (reference) => {
  const ref = String(reference || "").trim();
  if (!ref) return null;
  const target = ref.toUpperCase();

  const pickMatch = (list) =>
    (list || []).find(
      (p) =>
        String(p?.reference_number || "")
          .trim()
          .toUpperCase() === target
    ) || null;

  try {
    const exact = await withTimeout(
      callZoho("customerpayments", "GET", null, {
        reference_number: ref,
        per_page: 50,
        page: 1,
      }),
      12_000,
      "find-payment-by-reference",
    );
    const exactHit = pickMatch(exact.customerpayments || exact.payments || []);
    if (exactHit) return exactHit;

    if (ref !== target) {
      const upper = await withTimeout(
        callZoho("customerpayments", "GET", null, {
          reference_number: target,
          per_page: 50,
          page: 1,
        }),
        12_000,
        "find-payment-by-reference-upper",
      );
      const upperHit = pickMatch(upper.customerpayments || upper.payments || []);
      if (upperHit) return upperHit;
    }

    const searched = await withTimeout(
      callZoho("customerpayments", "GET", null, {
        search_text: ref,
        per_page: 50,
        page: 1,
      }),
      12_000,
      "find-payment-by-search-text",
    );
    return pickMatch(searched.customerpayments || searched.payments || []);
  } catch (error) {
    console.error(
      "findCustomerPaymentByReference_JS error:",
      error.response?.data || error.message
    );
    return null;
  }
};

const getCustomerPayment_JS = async (paymentId) => {
  try {
    if (!paymentId) return null;
    const data = await withTimeout(
      callZoho(`customerpayments/${paymentId}`, "GET"),
      10_000,
      "get-customer-payment",
    );
    return data.payment || data.customerpayment || data || null;
  } catch (error) {
    console.error(
      "getCustomerPayment_JS error:",
      error.response?.data || error.message
    );
    return null;
  }
};

const updateCustomerPayment_JS = async (paymentId, payload = {}) => {
  if (!paymentId) throw new Error("payment_id is required");
  const data = await withTimeout(
    callZoho(`customerpayments/${paymentId}`, "PUT", payload),
    12_000,
    "update-customer-payment",
  );
  return data.payment || data.customerpayment || data || null;
};

const BANK_ACCOUNT_CACHE_MS = 60 * 60 * 1000;
let mpesaDepositAccountCache = { id: null, expiresAt: 0 };

async function listBankAccounts_JS() {
  const data = await withTimeout(
    callZoho("bankaccounts", "GET", null, { page: 1, per_page: 200 }),
    10_000,
    "list-bank-accounts",
  );
  return data.bankaccounts || data.bank_accounts || [];
}

async function listChartOfAccounts_JS() {
  const data = await withTimeout(
    callZoho("chartofaccounts", "GET", null, { page: 1, per_page: 200 }),
    10_000,
    "list-chart-of-accounts",
  );
  return data.chartofaccounts || data.chart_of_accounts || [];
}

/**
 * Zoho Books "Deposited To" account_id for M-Pesa customer payments.
 * Prefers ZOHO_MPESA_ACCOUNT_ID; otherwise looks up MPESA PAYBILL NO 4185091.
 */
async function resolveMpesaDepositAccountId_JS() {
  const opts = mpesaDepositLookupOptions();
  if (opts.accountId) return opts.accountId;

  const now = Date.now();
  if (mpesaDepositAccountCache.id && now < mpesaDepositAccountCache.expiresAt) {
    return mpesaDepositAccountCache.id;
  }

  try {
    let accountId = pickDepositAccountId(await listBankAccounts_JS(), opts);
    if (!accountId) {
      accountId = pickDepositAccountId(await listChartOfAccounts_JS(), opts);
    }
    if (accountId) {
      mpesaDepositAccountCache = {
        id: accountId,
        expiresAt: now + BANK_ACCOUNT_CACHE_MS,
      };
      return accountId;
    }
    console.warn(
      `[zoho] M-Pesa deposit account "${opts.accountName}" not found. ` +
        "Set ZOHO_MPESA_ACCOUNT_ID so payments deposit to the paybill, not Paystack Funds."
    );
  } catch (error) {
    console.error(
      "resolveMpesaDepositAccountId_JS error:",
      error.response?.data || error.message
    );
  }
  return null;
}

// Get customers (array, filtered by company prefixes)
const getZohoCustomers_JS = async (params = {}) => {
  try {
    const page = Number(params.page || 1);
    const per_page = Math.min(Number(params.per_page || 50), 200);
    const search_text = params.search_text;

    const zohoParams = { page, per_page };
    if (search_text) zohoParams.search_text = search_text;

    const data = await withTimeout(
      callZoho("contacts", "GET", null, zohoParams),
      10_000,
      "contacts",
    );

    const allContacts = data.contacts || [];
    const allowedPrefixes = ["CL-", "ET-", "SKY-", "GM-"];

    const filtered = allContacts.filter((c) => {
      const company = c.company_name || "";
      return allowedPrefixes.some((p) => company.toUpperCase().startsWith(p));
    });

    return filtered.map(pickLean);
  } catch (error) {
    console.error(
      "getZohoCustomers_JS error:",
      error.response?.data || error.message,
    );
    return [];
  }
};

// Full contact record (includes contact_persons for updates).
const getContactFull_JS = async (contactId) => {
  if (!contactId) return null;
  try {
    const data = await withTimeout(
      callZoho(`contacts/${contactId}`, "GET", null, { per_page: 1 }),
      8000,
      "get-contact-full",
    );
    return data.contact || null;
  } catch (error) {
    console.error(
      "getContactFull_JS error:",
      error.response?.data || error.message,
    );
    return null;
  }
};

// Programmatic lookup (by ID/email/name) → contact or error string
const getSpecificCustomer_JS = async (idOrEmail) => {
  try {
    if (!idOrEmail || idOrEmail.trim().length === 0)
      return "Missing or empty customer identifier.";

    const key = `cust:${norm(idOrEmail)}`;
    const cachedVal = cache.get(key);
    if (cachedVal) return cachedVal;

    // Case 1: digits → contact_id
    if (/^\d+$/.test(idOrEmail)) {
      const data = await withTimeout(
        callZoho(`contacts/${idOrEmail}`, "GET", null, { per_page: 1 }),
        8000,
        "get-by-id",
      );
      const contact = pickLean(data.contact);
      cache.set(key, contact);
      return contact;
    }

    // Case 2: email (include inactive contacts)
    if (idOrEmail.includes("@")) {
      const result = await withTimeout(
        callZoho("contacts", "GET", null, {
          email: idOrEmail,
          per_page: 10,
          ...ZOHO_CONTACT_LIST_FILTER,
        }),
        8000,
        "get-by-email",
      );
      const ranked = rankContactMatches(idOrEmail, result.contacts || []);
      const hit = ranked[0]?.c || (result.contacts || [])[0];
      if (!hit) return "Customer not found with provided email.";
      const contact = pickLean(hit);
      cache.set(key, contact);
      return contact;
    }

    // Case 3: name/company using search_text (include inactive)
    let result;
    try {
      result = await withTimeout(
        callZoho("contacts", "GET", null, {
          search_text: idOrEmail,
          per_page: 10,
          page: 1,
          ...ZOHO_CONTACT_LIST_FILTER,
        }),
        9000,
        "search_text",
      );
    } catch (e) {
      // quick fallback
      result = await withTimeout(
        callZoho("contacts", "GET", null, {
          search_text: idOrEmail,
          per_page: 5,
          page: 1,
          ...ZOHO_CONTACT_LIST_FILTER,
        }),
        6000,
        "search_text_fallback",
      );
    }

    const list = result.contacts || [];
    if (list.length === 0) return "Customer not found with provided name.";

    const ranked = rankContactMatches(idOrEmail, list);
    if (!ranked.length) return "Customer not found with provided name.";

    const best = ranked[0].c;
    const contact = pickLean(best);
    cache.set(key, contact);
    return contact;
  } catch (error) {
    console.error(
      "getSpecificCustomer_JS error:",
      error.response?.data || error.message,
    );
    return "Error trying to execute function." + error.message;
  }
};

// Programmatic lookup by company name → contact or null/error string
const getCustomerByCompanyName_JS = async (rawName) => {
  try {
    if (!rawName || rawName.trim().length === 0)
      return "Missing or empty company name.";

    let companyName = decodeURIComponent(rawName);

    if (companyName.includes("=")) {
      companyName = companyName.split("=").pop();
    }
    companyName = companyName.replace(/^"|"$/g, "").trim();

    const key = `cust:company:${norm(companyName)}`;
    const cachedVal = cache.get(key);
    if (cachedVal) return cachedVal;

    // Numeric ID shortcut
    if (/^\d+$/.test(companyName)) {
      const data = await withTimeout(
        callZoho(`contacts/${companyName}`, "GET", null, { per_page: 1 }),
        8000,
        "get-by-id",
      );
      const contact = pickLean(data.contact);
      cache.set(key, contact);
      return contact;
    }

    // Search by company_name using search_text (include inactive contacts)
    let result;
    try {
      result = await withTimeout(
        callZoho("contacts", "GET", null, {
          search_text: companyName,
          per_page: 10,
          page: 1,
          ...ZOHO_CONTACT_LIST_FILTER,
        }),
        9000,
        "search_company",
      );
    } catch (e) {
      // quick fallback
      result = await withTimeout(
        callZoho("contacts", "GET", null, {
          search_text: companyName,
          per_page: 5,
          page: 1,
          ...ZOHO_CONTACT_LIST_FILTER,
        }),
        6000,
        "search_company_fallback",
      );
    }

    const list = result.contacts || [];
    if (list.length === 0)
      return "Customer not found with provided company name.";

    // Customer numbers (ET-RG02, CLB-A10) must match company_name exactly — no fuzzy hits.
    if (looksLikeCustomerNumber(companyName)) {
      const target = normalizeCustomerRef(companyName);
      const exact = list.filter((c) =>
        [c.company_name, c.contact_name, c.customer_name]
          .filter(Boolean)
          .some((field) => normalizeCustomerRef(field) === target)
      );
      if (!exact.length) {
        return "Customer not found with provided company name.";
      }
      const contact = pickLean(exact[0]);
      cache.set(key, contact);
      return contact;
    }

    // Score using full contact object — reject zero-score fuzzy hits.
    // Prefer active over inactive when scores are otherwise equal.
    const ranked = rankContactMatches(companyName, list);
    if (!ranked.length)
      return "Customer not found with provided company name.";

    const best = ranked[0].c;

    const contact = pickLean(best);
    cache.set(key, contact);
    return contact;
  } catch (error) {
    console.error(
      "getCustomerByCompanyName_JS error:",
      error.response?.data || error.message,
    );
    return "Error trying to execute function. " + error.message;
  }
};

/**
 * Find a Zoho contact by phone / mobile (includes inactive).
 */
const findContactByPhone_JS = async (rawPhone) => {
  const digits = normalizePhoneDigits(rawPhone);
  if (digits.length < 9) return null;

  const variants = new Set([String(rawPhone || "").trim(), digits]);
  if (digits.startsWith("254") && digits.length === 12) {
    variants.add(`0${digits.slice(3)}`);
    variants.add(`+${digits}`);
  } else if (digits.startsWith("0") && digits.length === 10) {
    variants.add(`254${digits.slice(1)}`);
    variants.add(`+254${digits.slice(1)}`);
  } else if (digits.length === 9) {
    variants.add(`0${digits}`);
    variants.add(`254${digits}`);
    variants.add(`+254${digits}`);
  }

  for (const phone of variants) {
    if (!phone) continue;
    try {
      const result = await withTimeout(
        callZoho("contacts", "GET", null, {
          phone,
          per_page: 10,
          ...ZOHO_CONTACT_LIST_FILTER,
        }),
        8000,
        "get-by-phone",
      );
      const list = result.contacts || [];
      const hit = list.find(
        (c) => phonesMatch(digits, c.phone) || phonesMatch(digits, c.mobile)
      );
      if (hit) return pickLean(hit);
    } catch {
      /* try next variant */
    }
  }

  // Fallback: search_text with local 0-prefixed form.
  const searchKey =
    digits.startsWith("254") && digits.length === 12
      ? `0${digits.slice(3)}`
      : digits;
  try {
    const result = await withTimeout(
      callZoho("contacts", "GET", null, {
        search_text: searchKey,
        per_page: 10,
        page: 1,
        ...ZOHO_CONTACT_LIST_FILTER,
      }),
      9000,
      "search_phone_text",
    );
    const list = result.contacts || [];
    const hit = list.find(
      (c) => phonesMatch(digits, c.phone) || phonesMatch(digits, c.mobile)
    );
    if (hit) return pickLean(hit);
  } catch {
    /* ignore */
  }

  return null;
};

/**
 * Resolve a Zoho contact from ordered lookup keys.
 * Email keys use the email filter; phone keys use phone search; others use
 * company/name search_text.
 * When customer is provided, reject contacts that do not match that customer.
 *
 * options.identityFallback — continue past a failed customer-number lookup and
 * accept email/phone identity matches even when company_name is not yet our
 * customer number (pre-existing Zoho contacts during onboarding).
 */
const findContactByLookupKeys_JS = async (lookupKeys = [], options = {}) => {
  const customer = options.customer || null;
  const identityFallback = options.identityFallback === true;
  const previousCustomerNumber = options.previousCustomerNumber
    ? String(options.previousCustomerNumber).trim()
    : "";
  const customerNumber = String(
    customer?.customerNumber || customer?.customer_number || ""
  ).trim();
  const hasCustomerNumber = Boolean(customerNumber);

  for (let i = 0; i < lookupKeys.length; i += 1) {
    const raw = lookupKeys[i];
    const key = String(raw || "").trim();
    if (!key) continue;

    // Do not fall back to email/name when a customer number exists but did not
    // match — unless identityFallback (onboarding / duplicate prevention).
    if (
      hasCustomerNumber &&
      i > 0 &&
      looksLikeCustomerNumber(customerNumber) &&
      !identityFallback
    ) {
      break;
    }

    const isEmailKey = key.includes("@");
    const isPhoneKey = looksLikePhoneKey(key);

    let result;
    if (isEmailKey) {
      result = await getSpecificCustomer_JS(key);
    } else if (isPhoneKey) {
      result = await findContactByPhone_JS(key);
    } else {
      result = await getCustomerByCompanyName_JS(key);
    }

    if (
      result &&
      typeof result === "object" &&
      !Array.isArray(result) &&
      result.contact_id
    ) {
      if (!customer) return result;

      if (zohoContactMatchesDashboardCustomer(result, customer)) {
        return result;
      }

      // Apartment / account renumber: contact still has the previous company_name.
      if (
        previousCustomerNumber &&
        normalizeCustomerRef(result.company_name) ===
          normalizeCustomerRef(previousCustomerNumber)
      ) {
        return result;
      }

      if (
        identityFallback &&
        (isEmailKey || isPhoneKey) &&
        zohoContactMatchesCustomerIdentity(result, customer)
      ) {
        return result;
      }

      // Name-only under identityFallback: exact contact name + no foreign customer number.
      if (identityFallback && !isEmailKey && !isPhoneKey) {
        const company = String(result.company_name || "").trim();
        const nameFields = [result.contact_name, result.customer_name]
          .filter(Boolean)
          .map((v) => normalizeCustomerRef(v));
        const queryNorm = normalizeCustomerRef(key);
        const nameHit =
          queryNorm && nameFields.some((f) => f === queryNorm);
        const foreignNumber =
          looksLikeCustomerNumber(company) &&
          customerNumber &&
          normalizeCustomerRef(company) !== normalizeCustomerRef(customerNumber) &&
          !(
            previousCustomerNumber &&
            normalizeCustomerRef(company) ===
              normalizeCustomerRef(previousCustomerNumber)
          );
        if (nameHit && !foreignNumber && (!company || !looksLikeCustomerNumber(company))) {
          return result;
        }
      }

      continue;
    }
  }
  return null;
};

// Items (array)
const getItems_JS = async () => {
  try {
    const result = await withTimeout(
      callZoho("items", "GET"),
      10_000,
      "get-items",
    );
    return result.items || [];
  } catch (error) {
    console.error("getItems_JS error:", error.response?.data || error.message);
    return [];
  }
};

const ITEM_SKU_PREFIXES = ["GM", "CL", "ENK", "SKY"];

function itemSkuMatchesAllowedPrefixes(item) {
  const sku = String(item?.sku ?? item?.SKU ?? "").trim();
  if (!sku) return false;
  const u = sku.toUpperCase();
  return ITEM_SKU_PREFIXES.some((p) => u.startsWith(p.toUpperCase()));
}

/** Paginate Zoho items and keep those whose SKU starts with GM, CL, ENK, or SKY */
const getItemsByAllowedSkuPrefixes_JS = async () => {
  const matched = [];
  let page = 1;
  const per_page = 200;
  const maxPages = 50;

  try {
    while (page <= maxPages) {
      const result = await withTimeout(
        callZoho("items", "GET", null, { page, per_page }),
        15_000,
        `get-items-sku-${page}`,
      );
      const items = result.items || [];
      for (const it of items) {
        if (itemSkuMatchesAllowedPrefixes(it)) matched.push(it);
      }
      const ctx = result.page_context;
      if (ctx && ctx.has_more_page === false) break;
      if (items.length < per_page) break;
      page += 1;
    }
    return matched;
  } catch (error) {
    console.error(
      "getItemsByAllowedSkuPrefixes_JS error:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

// Invoice templates (array)
const getInvoiceTemplates_JS = async () => {
  try {
    const result = await withTimeout(
      // This should become /books/v3/invoices/templates under the hood
      callZoho("invoices/templates", "GET"),
      10_000,
      "get-invoice-templates",
    );

    return result.templates || [];
  } catch (error) {
    console.error(
      "getInvoiceTemplates_JS error:",
      error.response?.data || error.message,
    );
    return [];
  }
};

// Create contact (object or null)
const createContact_JS = async (payload) => {
  try {
    if (!payload?.contact_name) {
      return null;
    }

    const createResult = await withTimeout(
      callZoho("contacts", "POST", payload),
      12_000,
      "create-contact",
    );
    const contact = pickLean(createResult.contact);
    if (contact?.contact_id) {
      cache.set(norm(contact.contact_name || contact.company_name || ""), contact);
      if (contact.company_name) {
        cache.set(norm(contact.company_name), contact);
      }
    }
    return contact;
  } catch (error) {
    const msg =
      error.response?.data?.message ||
      error.response?.data?.code ||
      error.message ||
      "";
    if (/already exists|duplicate contact|contact name already/i.test(String(msg))) {
      return null;
    }
    console.error(
      "createContact_JS error:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

const updateContact_JS = async (contactId, payload) => {
  if (!contactId || !payload) return null;

  const cacheContact = (contact) => {
    if (contact?.contact_id) {
      cache.set(norm(contact.contact_name || contact.company_name || ""), contact);
      if (contact.company_name) {
        cache.set(norm(contact.company_name), contact);
      }
    }
    return contact;
  };

  const putOnce = async (body) => {
    const data = await withTimeout(
      callZoho(`contacts/${contactId}`, "PUT", body),
      12_000,
      "update-contact",
    );
    return cacheContact(pickLean(data.contact));
  };

  try {
    return await putOnce(payload);
  } catch (error) {
    const zohoCode = error.response?.data?.code;
    const zohoMsg = String(error.response?.data?.message || error.message || "");
    const looksLikePersonDelete =
      Number(zohoCode) === 3043 ||
      /recurring invoice/i.test(zohoMsg) ||
      /delete only the contacts/i.test(zohoMsg);
    const looksLikePrimaryContactInvalid =
      Number(zohoCode) === 2 &&
      /is_primary_contact/i.test(zohoMsg);

    // Zoho sometimes rejects PUTs that include contact_persons when the contact
    // has recurring invoices (treats omitted persons as deletes). Retry without.
    // Also retry when Zoho rejects is_primary_contact on preserved persons.
    if (
      (looksLikePersonDelete || looksLikePrimaryContactInvalid) &&
      payload?.contact_persons
    ) {
      try {
        const { contact_persons, ...withoutPersons } = payload;
        console.warn(
          looksLikePrimaryContactInvalid
            ? "updateContact_JS: retrying without contact_persons after is_primary_contact error"
            : "updateContact_JS: retrying without contact_persons after Zoho 3043"
        );
        return await putOnce(withoutPersons);
      } catch (retryError) {
        console.error(
          "updateContact_JS retry error:",
          retryError.response?.data || retryError.message,
        );
        throw retryError;
      }
    }

    console.error(
      "updateContact_JS error:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

// Create invoice (object or null)
const createInvoice_JS = async ({
  customer_id,
  items,
  template_id,
  is_inclusive_tax,
  reference_number,
  invoice_number,
  discount,
  discount_type = "entity_level",
  is_discount_before_tax,
  due_date,
  payment_terms,
  payment_terms_label,
  billing_address,
  customer,
  notes,
}) => {
  try {
    if (!customer_id || !items?.length) {
      return null;
    }

    const { buildZohoBillingAddress } = require("../utils/zohoBillingAddress");
    const resolvedBilling =
      billing_address ||
      (customer ? buildZohoBillingAddress(customer) : null);

    const invoiceData = {
      customer_id,
      date: moment().format("YYYY-MM-DD"),
      line_items: items,
    };
    if (due_date) {
      invoiceData.due_date = String(due_date).slice(0, 10);
    }
    if (payment_terms != null && Number(payment_terms) >= 0) {
      invoiceData.payment_terms = Number(payment_terms);
    }
    if (payment_terms_label) {
      invoiceData.payment_terms_label = String(payment_terms_label);
    }
    if (is_inclusive_tax != null) {
      invoiceData.is_inclusive_tax = Boolean(is_inclusive_tax);
    }
    if (reference_number) {
      invoiceData.reference_number = String(reference_number);
    }
    if (invoice_number) {
      invoiceData.invoice_number = String(invoice_number);
    }
    if (notes) {
      invoiceData.notes = String(notes).slice(0, 2000);
    }
    if (discount != null && Number(discount) > 0) {
      invoiceData.discount = Number(discount);
      invoiceData.discount_type = discount_type;
      if (is_discount_before_tax != null) {
        invoiceData.is_discount_before_tax = Boolean(is_discount_before_tax);
      }
    }
    if (resolvedBilling) {
      invoiceData.billing_address = resolvedBilling;
    }

    const extraParams = invoice_number
      ? { ignore_auto_number_generation: true }
      : {};

    const createResult = await withTimeout(
      callZoho("invoices", "POST", invoiceData, extraParams),
      12_000,
      "create-invoice",
    );

    const invoice = createResult.invoice;

    if (template_id) {
      await withTimeout(
        callZoho(
          `invoices/${invoice.invoice_id}/templates/${template_id}`,
          "PUT",
        ),
        10_000,
        "update-invoice-template",
      );
    }

    return invoice;
  } catch (error) {
    const zohoError =
      error.response?.data?.message ||
      error.response?.data?.code ||
      error.message;
    console.error(
      "createInvoice_JS error:",
      error.response?.data || error.message,
    );
    const err = new Error(
      typeof zohoError === "string" ? zohoError : "Zoho invoice creation failed",
    );
    err.zoho = error.response?.data || null;
    throw err;
  }
};

/**
 * Create a Zoho Books credit note (object or null).
 * @see https://www.zoho.com/books/api/v3/credit-notes/#create-a-credit-note
 */
const createCreditNote_JS = async ({
  customer_id,
  items,
  reference_number,
  notes,
  is_inclusive_tax,
}) => {
  try {
    if (!customer_id || !items?.length) {
      return null;
    }

    const creditNoteData = {
      customer_id,
      date: moment().format("YYYY-MM-DD"),
      line_items: items,
    };
    if (reference_number) {
      creditNoteData.reference_number = String(reference_number);
    }
    if (notes) {
      creditNoteData.notes = String(notes);
    }
    if (is_inclusive_tax != null) {
      creditNoteData.is_inclusive_tax = Boolean(is_inclusive_tax);
    }

    const createResult = await withTimeout(
      callZoho("creditnotes", "POST", creditNoteData),
      12_000,
      "create-credit-note",
    );

    return createResult.creditnote || createResult.credit_note || null;
  } catch (error) {
    const zohoError =
      error.response?.data?.message ||
      error.response?.data?.code ||
      error.message;
    console.error(
      "createCreditNote_JS error:",
      error.response?.data || error.message,
    );
    const err = new Error(
      typeof zohoError === "string"
        ? zohoError
        : "Zoho credit note creation failed",
    );
    err.zoho = error.response?.data || null;
    throw err;
  }
};

function normalizeZohoMailIds(value) {
  const list = (Array.isArray(value) ? value : [value])
    .map((e) => String(e || "").trim().toLowerCase())
    .filter((e) => e.includes("@"));
  return [...new Set(list)];
}

async function resolveRequiredInvoiceCcMailIds(cc_mail_ids) {
  let cc = normalizeZohoMailIds(cc_mail_ids);
  if (cc.length) return cc;
  try {
    const { resolveInvoiceCcMailIds } = require("../services/appSettingsStore");
    cc = normalizeZohoMailIds(await resolveInvoiceCcMailIds());
  } catch (e) {
    console.warn("invoice CC lookup failed:", e.message);
  }
  return cc;
}

/** Email a Zoho Books invoice to the customer (1 API call). Never sends without CCs. */
const emailInvoice_JS = async ({ invoice_id, to_mail_ids, cc_mail_ids, subject, body }) => {
  try {
    if (!invoice_id) return false;
    const recipients = normalizeZohoMailIds(to_mail_ids);
    if (!recipients.length) return false;

    const cc = await resolveRequiredInvoiceCcMailIds(cc_mail_ids);
    if (!cc.length) {
      console.warn("emailInvoice_JS skipped: invoice CC emails are required");
      return false;
    }

    const payload = {
      to_mail_ids: recipients,
      cc_mail_ids: cc,
    };
    if (subject) payload.subject = subject;
    if (body) payload.body = body;

    await withTimeout(
      callZoho(`invoices/${invoice_id}/email`, "POST", payload),
      12_000,
      "email-invoice",
    );
    return true;
  } catch (error) {
    console.error(
      "emailInvoice_JS error:",
      error.response?.data || error.message,
    );
    return false;
  }
};

/**
 * Email a customer payment / receipt from Zoho Books (when the org supports it).
 * Falls back gracefully — callers should also email the paid invoice.
 */
const emailCustomerPayment_JS = async ({
  payment_id,
  to_mail_ids,
  cc_mail_ids,
  subject,
  body,
}) => {
  try {
    if (!payment_id) return false;
    const recipients = normalizeZohoMailIds(to_mail_ids);
    if (!recipients.length) return false;

    const cc = await resolveRequiredInvoiceCcMailIds(cc_mail_ids);
    if (!cc.length) {
      console.warn(
        "emailCustomerPayment_JS skipped: invoice CC emails are required"
      );
      return false;
    }

    const payload = { to_mail_ids: recipients, cc_mail_ids: cc };
    if (subject) payload.subject = subject;
    if (body) payload.body = body;

    await withTimeout(
      callZoho(`customerpayments/${payment_id}/email`, "POST", payload),
      12_000,
      "email-customer-payment",
    );
    return true;
  } catch (error) {
    console.warn(
      "emailCustomerPayment_JS unavailable or failed:",
      error.response?.data?.message || error.message
    );
    return false;
  }
};

// Mark invoice as paid (object or null). `amount` = total received; `amount_applied` = applied to invoice (excess becomes customer credit in Zoho).
const markInvoiceAsPaid_JS = async ({
  invoice_id,
  customer_id,
  amount,
  amount_applied,
  reference_number,
  description,
  payment_mode,
  account_id,
}) => {
  try {
    const paymentAmount = Number(amount);
    const applied = Number(amount_applied ?? amount);
    if (!invoice_id || !customer_id || !Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      return null;
    }
    if (!Number.isFinite(applied) || applied <= 0) {
      return null;
    }

    const paymentData = {
      customer_id,
      payment_mode: String(payment_mode || ZOHO_PAYMENT_MODE).trim() || ZOHO_PAYMENT_MODE,
      amount: paymentAmount,
      date: moment().format("YYYY-MM-DD"),
      invoices: [{ invoice_id, amount_applied: applied }],
    };
    if (reference_number) paymentData.reference_number = String(reference_number);
    if (description) paymentData.description = String(description);
    if (account_id) paymentData.account_id = String(account_id);

    const result = await withTimeout(
      callZoho("customerpayments", "POST", paymentData),
      12_000,
      "mark-paid",
    );
    return result.payment || null;
  } catch (error) {
    console.error(
      "markInvoiceAsPaid_JS error:",
      error.response?.data || error.message,
    );
    return null;
  }
};

/** ========= Express handlers (use req/res) ========= **/

// Get invoices over HTTP
const getInvoices = async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const per_page = Math.min(Number(req.query.per_page || 50), 200);
    const params = { page, per_page };

    const data = await withTimeout(
      callZoho("invoices", "GET", null, params),
      10_000,
      "get-invoices",
    );

    res.json({
      page,
      per_page,
      count: (data.invoices || []).length,
      more_pages: Boolean(data.page_context?.has_more_page),
      invoices: data.invoices || [],
    });
  } catch (error) {
    console.error("getInvoices error:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to fetch invoices",
      details: error.response?.data || error.message,
    });
  }
};

// Get all customers (paginated + optional query, filtered by prefixes)
const getZohoCustomers = async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const per_page = Math.min(Number(req.query.per_page || 50), 200);
    const search_text = req.query.search_text;

    const params = { page, per_page };
    if (search_text) params.search_text = search_text;

    const data = await withTimeout(
      callZoho("contacts", "GET", null, params),
      10_000,
      "contacts",
    );

    const allContacts = data.contacts || [];

    // Prefix filters (case-insensitive, safe)
    const allowedPrefixes = ["CL-", "ET-", "SKY-", "GM-"];

    const filteredContacts = allContacts.filter((c) => {
      const company = c.company_name || "";
      return allowedPrefixes.some((prefix) =>
        company.toUpperCase().startsWith(prefix),
      );
    });

    // Apply your lean mapper
    const contacts = filteredContacts.map(pickLean);

    res.json({
      page,
      per_page,
      count: contacts.length,
      more_pages: Boolean(data.page_context?.has_more_page),
      contacts,
    });
  } catch (error) {
    console.error(
      "getZohoCustomers error:",
      error.response?.data || error.message,
    );
    res.status(500).json({
      error: "Failed to fetch customers",
      details: error.response?.data || error.message,
    });
  }
};

// Programmatic lookup (kept compatible with your signature)
const getSpecificCustomer = getSpecificCustomer_JS;

// HTTP version: Fetch by company name via :companyName param
const getCustomerByCompanyName = async (req, res) => {
  try {
    const { companyName } = req.params;
    const result = await getCustomerByCompanyName_JS(companyName);

    if (!result || typeof result === "string") {
      return res.status(404).json({
        error: result || "Customer not found with provided company name.",
      });
    }

    return res.json(result);
  } catch (error) {
    console.error(
      "getCustomerByCompanyName error:",
      error.response?.data || error.message,
    );
    return res.status(500).json({
      error: "Error trying to execute function.",
      details: error.response?.data || error.message,
    });
  }
};

// HTTP version: Fetch by ID, Email, or Name
const getSpecificCustomerOriginal = async (req, res) => {
  try {
    const { idOrEmail } = req.params;
    if (!idOrEmail || idOrEmail.trim().length === 0) {
      return res
        .status(400)
        .json({ error: "Missing or empty customer identifier." });
    }

    const result = await getSpecificCustomer_JS(idOrEmail);

    if (!result || typeof result === "string") {
      return res.status(404).json({ error: result || "Customer not found." });
    }

    return res.json(result);
  } catch (error) {
    console.error(
      "Zoho fetch customer error:",
      error.response?.data || error.message,
    );
    res.status(500).json({
      error: "Failed to fetch customer",
      details: error.response?.data || error.message,
    });
  }
};

// HTTP: get items
const getItems = async (req, res) => {
  try {
    const items = await getItems_JS();
    res.json(items);
  } catch (error) {
    console.error("getItems error:", error.response?.data || error.message);

    res.status(500).json({
      error: "Failed to fetch items",
      details: error.response?.data || error.message,
    });
  }
};

// HTTP: items whose SKU starts with GM, CL, ENK, or SKY
const getItemsBySkuPrefixes = async (req, res) => {
  try {
    const items = await getItemsByAllowedSkuPrefixes_JS();
    res.json({
      count: items.length,
      sku_prefixes: ITEM_SKU_PREFIXES,
      items,
    });
  } catch (error) {
    console.error(
      "getItemsBySkuPrefixes error:",
      error.response?.data || error.message,
    );
    res.status(500).json({
      error: "Failed to fetch filtered items",
      details: error.response?.data || error.message,
    });
  }
};

// HTTP: get invoice templates
const getInvoiceTemplates = async (req, res) => {
  try {
    const templates = await getInvoiceTemplates_JS();

    console.log(
      "Raw Zoho invoice templates response (count):",
      templates.length,
    );

    res.json(templates);
  } catch (error) {
    console.error(
      "getInvoiceTemplates error:",
      error.response?.data || error.message,
    );
    res.status(500).json({
      error: "Failed to fetch invoice templates",
      details: error.response?.data || error.message,
    });
  }
};

// HTTP: Create invoice
const createInvoice = async (req, res) => {
  try {
    const invoice = await createInvoice_JS(req.body);

    if (!invoice) {
      return res.status(400).json({ error: "Missing customer_id or items" });
    }

    res.json(invoice);
  } catch (error) {
    console.error(
      "createInvoice error:",
      error.response?.data || error.message,
    );
    res.status(500).json({
      error: "Failed to create invoice",
      details: error.response?.data || error.message,
    });
  }
};

// HTTP: Mark invoice as paid
const markInvoiceAsPaid = async (req, res) => {
  try {
    const payment = await markInvoiceAsPaid_JS(req.body);
    if (!payment) {
      return res.status(400).json({
        error: "Missing invoice_id, customer_id or amount",
      });
    }
    res.json(payment);
  } catch (error) {
    console.error(
      "markInvoiceAsPaid error:",
      error.response?.data || error.message,
    );
    res.status(500).json({
      error: "Failed to mark invoice as paid",
      details: error.response?.data || error.message,
    });
  }
};

// Test route
const test = (req, res) => {
  res.json({ message: "Zoho API working ✅" });
};

/** ========= Exports ========= **/
module.exports = {
  // Express handlers
  getInvoices,
  getZohoCustomers,
  getCustomerByCompanyName,
  getSpecificCustomerOriginal,
  getItems,
  getItemsBySkuPrefixes,
  getInvoiceTemplates,
  createInvoice,
  markInvoiceAsPaid,
  test,

  // Programmatic/core JS functions
  getInvoices_JS,
  getRecurringInvoices_JS,
  getRecurringInvoice_JS,
  resumeRecurringInvoice_JS,
  stopRecurringInvoice_JS,
  createRecurringInvoice_JS,
  updateRecurringInvoice_JS,
  getCustomerPayments_JS,
  findCustomerPaymentByReference_JS,
  getCustomerPayment_JS,
  updateCustomerPayment_JS,
  resolveMpesaDepositAccountId_JS,
  getZohoCustomers_JS,
  getSpecificCustomer_JS,
  getContactFull_JS,
  getCustomerByCompanyName_JS,
  findContactByLookupKeys_JS,
  findContactByPhone_JS,
  getItems_JS,
  getItemsByAllowedSkuPrefixes_JS,
  getInvoiceTemplates_JS,
  createInvoice_JS,
  createCreditNote_JS,
  emailInvoice_JS,
  emailCustomerPayment_JS,
  createContact_JS,
  updateContact_JS,
  markContactInactive_JS,
  markContactActive_JS,
  invalidateZohoContactLookupCache,
  markInvoiceAsPaid_JS,

  // Extra helpers if you want them elsewhere
  callZoho,
  withTimeout,
  norm,
  scoreMatch,
  pickLean,
};
