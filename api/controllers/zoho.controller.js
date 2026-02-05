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

/** ========= Core JS functions (no req/res, return raw data) ========= **/

// Get invoices (array)
const getInvoices_JS = async (params = {}) => {
  try {
    const page = Number(params.page || 1);
    const per_page = Math.min(Number(params.per_page || 50), 200);
    const zohoParams = { page, per_page };

    const data = await withTimeout(
      callZoho("invoices", "GET", null, zohoParams),
      10_000,
      "get-invoices"
    );

    return data.invoices || [];
  } catch (error) {
    console.error(
      "getInvoices_JS error:",
      error.response?.data || error.message
    );
    return [];
  }
};

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
      "contacts"
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
      error.response?.data || error.message
    );
    return [];
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
      "getSpecificCustomer_JS error:",
      error.response?.data || error.message
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
        "get-by-id"
      );
      const contact = pickLean(data.contact);
      cache.set(key, contact);
      return contact;
    }

    // Search by company_name using search_text
    let result;
    try {
      result = await withTimeout(
        callZoho("contacts", "GET", null, {
          search_text: companyName,
          per_page: 10,
          page: 1,
        }),
        9000,
        "search_company"
      );
    } catch (e) {
      // quick fallback
      result = await withTimeout(
        callZoho("contacts", "GET", null, {
          search_text: companyName,
          per_page: 5,
          page: 1,
        }),
        6000,
        "search_company_fallback"
      );
    }

    const list = result.contacts || [];
    if (list.length === 0)
      return "Customer not found with provided company name.";

    // Score using full contact object
    const best = list
      .map((c) => ({ c, s: scoreMatch(companyName, c) }))
      .sort((a, b) => b.s - a.s)[0].c;

    const contact = pickLean(best);
    cache.set(key, contact);
    return contact;
  } catch (error) {
    console.error(
      "getCustomerByCompanyName_JS error:",
      error.response?.data || error.message
    );
    return "Error trying to execute function. " + error.message;
  }
};

// Items (array)
const getItems_JS = async () => {
  try {
    const result = await withTimeout(
      callZoho("items", "GET"),
      10_000,
      "get-items"
    );
    return result.items || [];
  } catch (error) {
    console.error("getItems_JS error:", error.response?.data || error.message);
    return [];
  }
};

// Invoice templates (array)
const getInvoiceTemplates_JS = async () => {
  try {
    const result = await withTimeout(
      // This should become /books/v3/invoices/templates under the hood
      callZoho("invoices/templates", "GET"),
      10_000,
      "get-invoice-templates"
    );

    return result.templates || [];
  } catch (error) {
    console.error(
      "getInvoiceTemplates_JS error:",
      error.response?.data || error.message
    );
    return [];
  }
};

// Create invoice (object or null)
const createInvoice_JS = async ({ customer_id, items, template_id }) => {
  try {
    if (!customer_id || !items?.length) {
      return null;
    }

    const invoiceData = {
      customer_id,
      date: moment().format("YYYY-MM-DD"),
      line_items: items,
    };

    // 1) Create invoice
    const createResult = await withTimeout(
      callZoho("invoices", "POST", invoiceData),
      12_000,
      "create-invoice"
    );

    const invoice = createResult.invoice;

    // 2) If template_id provided, update invoice template
    if (template_id) {
      await withTimeout(
        callZoho(
          `invoices/${invoice.invoice_id}/templates/${template_id}`,
          "PUT"
        ),
        10_000,
        "update-invoice-template"
      );
    }

    return invoice;
  } catch (error) {
    console.error(
      "createInvoice_JS error:",
      error.response?.data || error.message
    );
    return null;
  }
};

// Mark invoice as paid (object or null)
const markInvoiceAsPaid_JS = async ({ invoice_id, customer_id, amount }) => {
  try {
    if (!invoice_id || !customer_id || !amount) {
      return null;
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
    return result.payment || null;
  } catch (error) {
    console.error(
      "markInvoiceAsPaid_JS error:",
      error.response?.data || error.message
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
      "get-invoices"
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
      "contacts"
    );

    const allContacts = data.contacts || [];

    // Prefix filters (case-insensitive, safe)
    const allowedPrefixes = ["CL-", "ET-", "SKY-", "GM-"];

    const filteredContacts = allContacts.filter((c) => {
      const company = c.company_name || "";
      return allowedPrefixes.some((prefix) =>
        company.toUpperCase().startsWith(prefix)
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
      error.response?.data || error.message
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
      error.response?.data || error.message
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
      error.response?.data || error.message
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

// HTTP: get invoice templates
const getInvoiceTemplates = async (req, res) => {
  try {
    const templates = await getInvoiceTemplates_JS();

    console.log(
      "Raw Zoho invoice templates response (count):",
      templates.length
    );

    res.json(templates);
  } catch (error) {
    console.error(
      "getInvoiceTemplates error:",
      error.response?.data || error.message
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
      error.response?.data || error.message
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
      error.response?.data || error.message
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
  getInvoiceTemplates,
  createInvoice,
  markInvoiceAsPaid,
  test,

  // Programmatic/core JS functions
  getInvoices_JS,
  getZohoCustomers_JS,
  getSpecificCustomer_JS,
  getCustomerByCompanyName_JS,
  getItems_JS,
  getInvoiceTemplates_JS,
  createInvoice_JS,
  markInvoiceAsPaid_JS,

  // Extra helpers if you want them elsewhere
  callZoho,
  withTimeout,
  norm,
  scoreMatch,
  pickLean,
};
