// zohoController.optimized.js
// deps: npm i lru-cache axios
const axios = require("axios");
const https = require("https");
const moment = require("moment");
const LRU = require("lru-cache");
require("dotenv").config();

/** ========= Config ========= **/
const ZOHO_AUTH_URL =
  process.env.ZOHO_AUTH_URL || "https://accounts.zoho.com/oauth/v2/token";
const ZOHO_BASE_URL = process.env.ZOHO_BASE_URL; // e.g. https://books.zoho.com/api/v3
const ZOHO_ORG_ID = process.env.ZOHO_ORG_ID;
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;

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

// Attach token per request
zoho.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  config.headers.Authorization = `Zoho-oauthtoken ${token}`;
  // Always include org id in query
  config.params = { ...(config.params || {}), organization_id: ZOHO_ORG_ID };
  return config;
});

// Simple retry with exponential backoff + jitter; honors Retry-After
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
zoho.interceptors.response.use(
  (res) => res,
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

    return Promise.reject(error);
  }
);

/** ========= Helpers ========= **/
const withTimeout = (promise, ms, label = "op") =>
  Promise.race([
    promise,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);

async function callZoho(
  endpoint,
  method = "GET",
  data = null,
  extraParams = {}
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
    status,
    currency_code,
    outstanding_receivable_amount,
  };
};

/** ========= Small LRU cache for hot lookups ========= **/
const cache = new LRU({ max: 500, ttl: 5 * 60 * 1000 });

/** ========= Controller ========= **/
module.exports = {
  // Get all customers (paginated + optional query)
  getZohoCustomers: async (req, res) => {
    try {
      const page = Number(req.query.page || 1);
      const per_page = Math.min(Number(req.query.per_page || 50), 200);
      const search_text = req.query.search_text;

      const params = { page, per_page };
      if (search_text) params.search_text = search_text;

      const data = await withTimeout(
        callZoho("contacts", "GET", null, params),
        10_000,
        "contacts"
      );
      const contacts = (data.contacts || []).map(pickLean);
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
        error.response?.data || error.message
      );
      res.status(500).json({
        error: "Failed to fetch customers",
        details: error.response?.data || error.message,
      });
    }
  },

  // Programmatic lookup (kept compatible with your signature)
  getSpecificCustomer: async (idOrEmail) => {
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
          "get-by-id"
        );
        const contact = pickLean(data.contact);
        cache.set(key, contact);
        return contact;
      }

      // Case 2: email
      if (idOrEmail.includes("@")) {
        const result = await withTimeout(
          callZoho("contacts", "GET", null, { email: idOrEmail, per_page: 1 }),
          8000,
          "get-by-email"
        );
        const hit = (result.contacts || [])[0];
        if (!hit) return "Customer not found with provided email.";
        const contact = pickLean(hit);
        cache.set(key, contact);
        return contact;
      }

      // Case 3: name/company using search_text (small page + local scoring)
      let result;
      try {
        result = await withTimeout(
          callZoho("contacts", "GET", null, {
            search_text: idOrEmail,
            per_page: 10,
            page: 1,
          }),
          9000,
          "search_text"
        );
      } catch (e) {
        // quick fallback
        result = await withTimeout(
          callZoho("contacts", "GET", null, {
            search_text: idOrEmail,
            per_page: 5,
            page: 1,
          }),
          6000,
          "search_text_fallback"
        );
      }

      const list = result.contacts || [];
      if (list.length === 0) return "Customer not found with provided name.";

      const best = list
        .map((c) => ({ c, s: scoreMatch(idOrEmail, c) }))
        .sort((a, b) => b.s - a.s)[0].c;
      const contact = pickLean(best);
      cache.set(key, contact);
      return contact;
    } catch (error) {
      console.error(
        "getSpecificCustomer error:",
        error.response?.data || error.message
      );
      return "Error trying to execute function." + error.message;
    }
  },

  // HTTP version: Fetch by ID, Email, or Name
  getSpecificCustomerOriginal: async (req, res) => {
    try {
      const { idOrEmail } = req.params;
      if (!idOrEmail || idOrEmail.trim().length === 0) {
        return res
          .status(400)
          .json({ error: "Missing or empty customer identifier." });
      }

      const key = `cust:${norm(idOrEmail)}`;
      const cachedVal = cache.get(key);
      if (cachedVal) return res.json(cachedVal);

      // ID
      if (/^\d+$/.test(idOrEmail)) {
        const data = await withTimeout(
          callZoho(`contacts/${idOrEmail}`, "GET", null, { per_page: 1 }),
          8000,
          "get-by-id"
        );
        const contact = pickLean(data.contact);
        cache.set(key, contact);
        return res.json(contact);
      }

      // Email
      if (idOrEmail.includes("@")) {
        const result = await withTimeout(
          callZoho("contacts", "GET", null, { email: idOrEmail, per_page: 1 }),
          8000,
          "get-by-email"
        );
        const hit = (result.contacts || [])[0];
        if (!hit)
          return res
            .status(404)
            .json({ error: "Customer not found with provided email." });
        const contact = pickLean(hit);
        cache.set(key, contact);
        return res.json(contact);
      }

      // Name/company via search_text
      let result;
      try {
        result = await withTimeout(
          callZoho("contacts", "GET", null, {
            search_text: idOrEmail,
            per_page: 10,
            page: 1,
          }),
          9000,
          "search_text"
        );
      } catch (e) {
        result = await withTimeout(
          callZoho("contacts", "GET", null, {
            search_text: idOrEmail,
            per_page: 5,
            page: 1,
          }),
          6000,
          "search_text_fallback"
        );
      }

      const list = result.contacts || [];
      if (list.length === 0) {
        return res
          .status(404)
          .json({ error: "Customer not found with provided name." });
      }

      const best = list
        .map((c) => ({ c, s: scoreMatch(idOrEmail, c) }))
        .sort((a, b) => b.s - a.s)[0].c;
      const contact = pickLean(best);
      cache.set(key, contact);
      return res.json(contact);
    } catch (error) {
      console.error(
        "Zoho fetch customer error:",
        error.response?.data || error.message
      );
      res.status(500).json({
        error: "Failed to fetch customer",
        details: error.response?.data || error.message,
      });
    }
  },

  // Create invoice
  createInvoice: async (req, res) => {
    try {
      const { customer_id, items } = req.body;
      if (!customer_id || !items?.length) {
        return res.status(400).json({ error: "Missing customer_id or items" });
      }

      const invoiceData = {
        customer_id,
        date: moment().format("YYYY-MM-DD"),
        line_items: items,
      };

      const result = await withTimeout(
        callZoho("invoices", "POST", invoiceData),
        12_000,
        "create-invoice"
      );
      res.json(result.invoice);
    } catch (error) {
      console.error(
        "createInvoice error:",
        error.response?.data || error.message
      );
      res.status(500).json({
        error: "Failed to create invoice",
        details: error.response?.data || error.message,
      });
    }
  },

  // Mark invoice as paid
  markInvoiceAsPaid: async (req, res) => {
    try {
      const { invoice_id, customer_id, amount } = req.body;
      if (!invoice_id || !customer_id || !amount) {
        return res
          .status(400)
          .json({ error: "Missing invoice_id, customer_id or amount" });
      }

      const paymentData = {
        customer_id,
        payment_mode: "cash",
        amount,
        date: moment().format("YYYY-MM-DD"),
        invoices: [{ invoice_id, amount_applied: amount }],
      };

      const result = await withTimeout(
        callZoho("customerpayments", "POST", paymentData),
        12_000,
        "mark-paid"
      );
      res.json(result.payment);
    } catch (error) {
      console.error(
        "markInvoiceAsPaid error:",
        error.response?.data || error.message
      );
      res.status(500).json({
        error: "Failed to mark invoice as paid",
        details: error.response?.data || error.message,
      });
    }
  },

  // Test route
  test: (req, res) => {
    res.json({ message: "Zoho API working ✅" });
  },
};
