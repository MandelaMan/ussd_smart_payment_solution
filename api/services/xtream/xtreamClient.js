const axios = require("axios");

/**
 * Xtream billing API — xtream_ui_r22_backend_api_document.docx
 * Base: http://PANEL:25500/api.php (internal / localhost only — not exposed publicly)
 * All calls: GET with action, sub, developer_username, developer_password, then payload.
 */

function normalizeBaseUrl(raw) {
  const base = String(raw || "http://127.0.0.1:25500").trim();
  return base.replace(/\/+$/, "").replace(/\/api\.php$/i, "");
}

function getBaseUrl() {
  return normalizeBaseUrl(process.env.XTREAM_BASE_URL);
}

function getApiUrl() {
  return `${getBaseUrl()}/api.php`;
}

function cleanEnvValue(raw) {
  const s = String(raw || "").trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function readDeveloperPair() {
  return {
    developer_username: cleanEnvValue(
      process.env.XTREAM_DEVELOPER_USERNAME || process.env.XTREAM_ADMIN_USERNAME
    ),
    developer_password: cleanEnvValue(
      process.env.XTREAM_DEVELOPER_PASSWORD || process.env.XTREAM_ADMIN_PASSWORD
    ),
  };
}

function getDeveloperCredentials() {
  const pair = readDeveloperPair();
  if (!pair.developer_username || !pair.developer_password) {
    throw new Error(
      "XTREAM_DEVELOPER_USERNAME and XTREAM_DEVELOPER_PASSWORD are required in .env"
    );
  }
  return pair;
}

function buildDocQuery(action, sub, payload = {}, credsOverride) {
  const creds = credsOverride || getDeveloperCredentials();
  return {
    action,
    sub,
    developer_username: creds.developer_username,
    developer_password: creds.developer_password,
    ...payload,
  };
}

function formatBouquetParam(bouquet) {
  const ids = (Array.isArray(bouquet) ? bouquet : [bouquet])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) throw new Error("bouquet must contain at least one valid integer ID");
  return JSON.stringify(ids);
}

function redactParams(params) {
  const copy = { ...params };
  if (copy.developer_password) copy.developer_password = "[redacted]";
  if (copy.password) copy.password = "[redacted]";
  return copy;
}

function buildQueryString(params) {
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.join("&");
}

function buildRequestUrl(baseApiUrl, params) {
  const qs = buildQueryString(params);
  return qs ? `${baseApiUrl}?${qs}` : baseApiUrl;
}

function buildFullEndpoint(baseApiUrl, params) {
  const qs = buildQueryString(redactParams(params));
  return qs ? `${baseApiUrl}?${qs}` : baseApiUrl;
}

function parseResponseData(data) {
  if (data == null || data === "") {
    return {
      status: "error",
      message:
        "Empty panel response — api.php is internal-only: set XTREAM_BASE_URL to " +
        "http://127.0.0.1:25500 when this app runs on the panel server, and verify " +
        "developer_username/developer_password.",
    };
  }
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed) {
      return {
        status: "error",
        message:
          "Empty panel response — use localhost URL (127.0.0.1:25500) from the panel host; " +
          "the API is not reachable from external IPs.",
      };
    }
    if (trimmed.startsWith("<")) {
      return { status: "error", message: "HTML response (not API JSON)", raw: trimmed.slice(0, 300) };
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return { status: "error", message: "Non-JSON response", raw: trimmed.slice(0, 300) };
    }
  }
  return data;
}

function responseErrorMessage(data) {
  const parsed = parseResponseData(data);
  if (Array.isArray(parsed)) return null;
  if (parsed && typeof parsed === "object") {
    if (parsed.result === false && parsed.error) return String(parsed.error);
    const msg = parsed.message || parsed.error || parsed.msg;
    if (msg) return String(msg);
    if (parsed.status === "error") return JSON.stringify(parsed);
  }
  return null;
}

function isSuccessResponse(data) {
  const parsed = parseResponseData(data);
  if (Array.isArray(parsed)) return true;
  if (!parsed || typeof parsed !== "object") return false;
  if (parsed.result === true || parsed.result === "true") return true;
  if (parsed.id != null && parsed.username) return true;
  const status = String(parsed.status || "").toLowerCase();
  if (status === "error") return false;
  return status === "success" || status === "ok";
}

function describeApiResult(result) {
  if (result.ok) return "success";
  const err = responseErrorMessage(result.data);
  if (err) return err;
  if (result.diagnostics?.responseBodyLength === 0) {
    return (
      "Empty panel response — XTREAM_BASE_URL must be reachable locally " +
      "(e.g. http://127.0.0.1:25500 on the panel server; not a public IP)."
    );
  }
  if (result.httpStatus >= 400) return `HTTP ${result.httpStatus}`;
  return "Request failed (see logs/xtream-sync.jsonl)";
}

async function xtreamApiRequest(action, sub, payload = {}) {
  const apiUrl = getApiUrl();
  const query = buildDocQuery(action, sub, payload);
  const requestUrl = buildRequestUrl(apiUrl, query);
  const endpoint = buildFullEndpoint(apiUrl, query);

  const response = await axios({
    method: "GET",
    url: requestUrl,
    timeout: Number(process.env.XTREAM_REQUEST_TIMEOUT_MS || 20000),
    validateStatus: () => true,
    transformResponse: [(raw) => raw],
    headers: { Accept: "application/json, text/plain, */*" },
  });

  const rawData = response.data;
  const rawText = rawData == null ? "" : String(rawData);
  const data = parseResponseData(rawData);

  return {
    ok: response.status >= 200 && response.status < 300 && isSuccessResponse(data),
    httpStatus: response.status,
    endpoint,
    data,
    diagnostics: {
      responseBodyLength: rawText.length,
      contentType: response.headers["content-type"] || null,
      method: "GET",
    },
    request: {
      method: "GET",
      url: apiUrl,
      endpoint,
      params: redactParams(query),
    },
  };
}

async function getBouquets() {
  return xtreamApiRequest("bouquet", "get");
}

async function getUserProfile(username) {
  if (!username) throw new Error("getUserProfile requires username");
  return xtreamApiRequest("user", "get", { username: String(username).trim() });
}

async function createSubscriptionLine({ username, password, max_connections = 1, exp_date, bouquet }) {
  if (!username || !password) throw new Error("createSubscriptionLine requires username and password");
  const exp = Number(exp_date);
  if (!Number.isFinite(exp) || exp <= 0) {
    throw new Error("createSubscriptionLine requires exp_date as Unix epoch seconds");
  }
  return xtreamApiRequest("user", "create", {
    username: String(username).trim(),
    password: String(password),
    max_connections: Math.max(1, Math.floor(Number(max_connections) || 1)),
    exp_date: Math.floor(exp),
    bouquet: formatBouquetParam(bouquet),
  });
}

async function editSubscriptionLine({ username, exp_date, bouquet }) {
  if (!username) throw new Error("editSubscriptionLine requires username");
  const payload = { username: String(username).trim() };
  if (exp_date != null) {
    const exp = Number(exp_date);
    if (!Number.isFinite(exp) || exp <= 0) {
      throw new Error("editSubscriptionLine exp_date must be a positive Unix epoch when provided");
    }
    payload.exp_date = Math.floor(exp);
  }
  if (bouquet != null) payload.bouquet = formatBouquetParam(bouquet);
  if (payload.exp_date == null && payload.bouquet == null) {
    throw new Error("editSubscriptionLine requires exp_date and/or bouquet");
  }
  return xtreamApiRequest("user", "edit", payload);
}

async function disableSubscriptionLine(username) {
  return xtreamApiRequest("user", "disable", { username: String(username).trim() });
}

async function enableSubscriptionLine(username) {
  return xtreamApiRequest("user", "enable", { username: String(username).trim() });
}

module.exports = {
  getBaseUrl,
  getApiUrl,
  getDeveloperCredentials,
  readDeveloperPair,
  buildDocQuery,
  parseResponseData,
  describeApiResult,
  buildFullEndpoint,
  buildRequestUrl,
  buildQueryString,
  formatBouquetParam,
  getBouquets,
  getUserProfile,
  createSubscriptionLine,
  editSubscriptionLine,
  disableSubscriptionLine,
  enableSubscriptionLine,
};
