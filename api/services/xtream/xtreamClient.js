const axios = require("axios");

/**
 * Xtream Codes streaming API (wwwdir/api.php on http_broadcast port, e.g. 25461).
 * Auth: billing server IP must be in panel Settings → API IP's (api_ips).
 * User create/edit: POST with user_data[...] fields.
 */

function normalizeBaseUrl(raw) {
  const base = String(raw || "").trim();
  if (!base) throw new Error("XTREAM_BASE_URL is required");
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

function getDeveloperCredentials() {
  const developer_username = cleanEnvValue(process.env.XTREAM_DEVELOPER_USERNAME);
  const developer_password = cleanEnvValue(process.env.XTREAM_DEVELOPER_PASSWORD);
  if (!developer_username || !developer_password) {
    throw new Error(
      "XTREAM_DEVELOPER_USERNAME and XTREAM_DEVELOPER_PASSWORD are required"
    );
  }
  return { developer_username, developer_password };
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

function redactUserData(userData) {
  const copy = { ...userData };
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

function buildRequestUrl(apiUrl, params) {
  const qs = buildQueryString(params);
  return qs ? `${apiUrl}?${qs}` : apiUrl;
}

function buildFullEndpoint(apiUrl, params) {
  return buildRequestUrl(apiUrl, redactParams(params));
}

function encodeUserDataBody(userData) {
  const parts = [];
  for (const [key, value] of Object.entries(userData)) {
    if (value == null || value === "") continue;
    parts.push(
      `${encodeURIComponent(`user_data[${key}]`)}=${encodeURIComponent(String(value))}`
    );
  }
  return parts.join("&");
}

function parseResponseData(data) {
  if (data == null || data === "") {
    return { status: "error", message: "Empty panel response" };
  }
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed) return { status: "error", message: "Empty panel response" };
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

function isSuccessResponse(data) {
  const parsed = parseResponseData(data);
  if (Array.isArray(parsed)) return true;
  if (!parsed || typeof parsed !== "object") return false;
  if (parsed.result === true) return true;
  if (parsed.result === false) return false;
  const status = String(parsed.status || "").toLowerCase();
  if (status === "error") return false;
  return status === "success" || status === "ok" || status === "true";
}

function responseErrorMessage(data) {
  const parsed = parseResponseData(data);
  if (Array.isArray(parsed)) return null;
  if (parsed && typeof parsed === "object") {
    const msg = parsed.message || parsed.error || parsed.msg || parsed[0];
    if (msg) return String(msg);
    if (parsed.result === false) return JSON.stringify(parsed);
    if (parsed.status === "error") return JSON.stringify(parsed);
  }
  return null;
}

function describeApiResult(result) {
  if (result.ok) return "success";
  const err = responseErrorMessage(result.data);
  if (err) return err;
  if (result.diagnostics?.responseBodyLength === 0) {
    return (
      "Empty panel response — use streaming port 25461 (not admin 25500); whitelist billing server IP in panel API IP settings"
    );
  }
  if (result.httpStatus >= 400) return `HTTP ${result.httpStatus}`;
  return "Request failed (see logs/xtream-sync.jsonl)";
}

function buildApiResult(response, { endpoint, method, requestMeta, data }) {
  const rawText = response.data == null ? "" : String(response.data);
  return {
    ok: response.status >= 200 && response.status < 300 && isSuccessResponse(data),
    httpStatus: response.status,
    endpoint,
    data,
    diagnostics: {
      responseBodyLength: rawText.length,
      contentType: response.headers["content-type"] || null,
      server: response.headers["server"] || null,
      setCookie: Boolean(response.headers["set-cookie"]),
      method,
    },
    request: requestMeta,
  };
}

async function apiGet(action, sub, payload = {}) {
  const apiUrl = getApiUrl();
  const query = { action, sub, ...payload };
  const requestUrl = buildRequestUrl(apiUrl, query);
  const endpoint = buildFullEndpoint(apiUrl, query);

  const response = await axios.get(requestUrl, {
    timeout: Number(process.env.XTREAM_REQUEST_TIMEOUT_MS || 20000),
    validateStatus: () => true,
    transformResponse: [(raw) => raw],
    headers: { Accept: "application/json, text/plain, */*" },
  });

  const data = parseResponseData(response.data);
  return buildApiResult(response, {
    endpoint,
    method: "GET",
    requestMeta: { method: "GET", endpoint, params: redactParams(query) },
    data,
  });
}

async function apiPost(action, sub, userData = {}) {
  const apiUrl = getApiUrl();
  const query = { action, sub };
  const requestUrl = buildRequestUrl(apiUrl, query);
  const endpoint = buildFullEndpoint(apiUrl, query);
  const body = encodeUserDataBody(userData);

  const response = await axios.post(requestUrl, body, {
    timeout: Number(process.env.XTREAM_REQUEST_TIMEOUT_MS || 20000),
    validateStatus: () => true,
    transformResponse: [(raw) => raw],
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const data = parseResponseData(response.data);
  return buildApiResult(response, {
    endpoint,
    method: "POST",
    requestMeta: {
      method: "POST",
      endpoint,
      user_data: redactUserData(userData),
    },
    data,
  });
}

/** Health check — bouquet&sub=get is not supported on standard Xtream Codes builds. */
async function pingApi() {
  return apiGet("server", "list");
}

async function getBouquets() {
  return pingApi();
}

async function createSubscriptionLine({ username, password, max_connections = 1, exp_date, bouquet }) {
  if (!username || !password) throw new Error("createSubscriptionLine requires username and password");
  const exp = Number(exp_date);
  if (!Number.isFinite(exp) || exp <= 0) {
    throw new Error("createSubscriptionLine requires exp_date as Unix epoch seconds");
  }
  return apiPost("user", "create", {
    username: String(username).trim(),
    password: String(password),
    max_connections: Math.max(1, Math.floor(Number(max_connections) || 1)),
    exp_date: Math.floor(exp),
    bouquet: formatBouquetParam(bouquet),
  });
}

async function editSubscriptionLine({ username, exp_date, bouquet }) {
  if (!username) throw new Error("editSubscriptionLine requires username");
  const userData = { username: String(username).trim() };
  if (exp_date != null) {
    const exp = Number(exp_date);
    if (!Number.isFinite(exp) || exp <= 0) {
      throw new Error("editSubscriptionLine exp_date must be a positive Unix epoch when provided");
    }
    userData.exp_date = Math.floor(exp);
  }
  if (bouquet != null) {
    userData.bouquet = formatBouquetParam(bouquet);
  }
  if (userData.exp_date == null && userData.bouquet == null) {
    throw new Error("editSubscriptionLine requires exp_date and/or bouquet");
  }
  return apiPost("user", "edit", userData);
}

async function disableSubscriptionLine(username) {
  if (!username) throw new Error("disableSubscriptionLine requires username");
  return apiGet("user", "disable", { username: String(username).trim() });
}

async function enableSubscriptionLine(username) {
  if (!username) throw new Error("enableSubscriptionLine requires username");
  return apiGet("user", "enable", { username: String(username).trim() });
}

module.exports = {
  getBaseUrl,
  getApiUrl,
  getDeveloperCredentials,
  buildFullEndpoint,
  buildRequestUrl,
  buildQueryString,
  formatBouquetParam,
  parseResponseData,
  describeApiResult,
  isSuccessResponse,
  responseErrorMessage,
  pingApi,
  getBouquets,
  createSubscriptionLine,
  editSubscriptionLine,
  disableSubscriptionLine,
  enableSubscriptionLine,
};
