const axios = require("axios");

/**
 * Xtream UI R22 / R22F (classic v2 api.php on admin port, e.g. 25500).
 *
 * R22F uses the original Xtream Codes v2 API:
 *   - IP whitelist (Settings > API IP's) — no developer_username in query
 *   - bouquet get: GET  api.php?action=bouquet&sub=get
 *   - user ops:    POST api.php?action=user&sub=create|edit|info|disable|enable
 *                  body uses user_data[...] (create) or username+password+user_data (edit)
 *
 * Optional XTREAM_API_MODE=billing for GET + developer_username/password (custom billing doc).
 */

function normalizeBaseUrl(raw) {
  const base = String(raw || "http://100.121.223.62:25500").trim();
  return base.replace(/\/+$/, "").replace(/\/api\.php$/i, "");
}

function getBaseUrl() {
  return normalizeBaseUrl(process.env.XTREAM_BASE_URL);
}

function getApiUrl() {
  return `${getBaseUrl()}/api.php`;
}

function getApiMode() {
  return String(process.env.XTREAM_API_MODE || "r22f").toLowerCase();
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

function buildBillingQuery(action, sub, payload = {}, credsOverride) {
  const creds = credsOverride || getDeveloperCredentials();
  return {
    action,
    sub,
    developer_username: creds.developer_username,
    developer_password: creds.developer_password,
    ...payload,
  };
}

function flattenUserData(payload) {
  const body = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value == null || value === "") continue;
    body[`user_data[${key}]`] = String(value);
  }
  return body;
}

function buildV2PostBody(action, sub, payload = {}) {
  const { username, password, user_data: userData, ...rest } = payload;
  const body = {};
  if (username != null && username !== "") body.username = String(username);
  if (password != null && password !== "") body.password = String(password);
  Object.assign(body, flattenUserData(userData || {}));
  for (const [key, value] of Object.entries(rest)) {
    if (value == null || value === "") continue;
    body[key] = String(value);
  }
  return body;
}

function parseResponseData(data) {
  if (data == null || data === "") {
    return {
      status: "error",
      message:
        "Empty panel response — for R22F: whitelist billing server IP under Settings > API IP's. " +
        "Classic v2 api.php does not use developer_username; auth is IP-based.",
    };
  }
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed) {
      return {
        status: "error",
        message:
          "Empty panel response — whitelist billing server IP in Settings > API IP's (R22F v2 API).",
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
    if (parsed["0"]) return String(parsed["0"]);
  }
  return null;
}

function isSuccessResponse(data) {
  const parsed = parseResponseData(data);
  if (Array.isArray(parsed)) return true;
  if (!parsed || typeof parsed !== "object") return false;
  if (parsed.result === true || parsed.result === "true") return true;
  if (parsed.user_info && typeof parsed.user_info === "object") return true;
  if (parsed.id != null && parsed.username) return true;
  const status = String(parsed.status || "").toLowerCase();
  if (status === "error") return false;
  return status === "success" || status === "ok";
}

function describeApiResult(result) {
  if (result.ok) return "success";
  const err = responseErrorMessage(result.data);
  if (err) return err;
  if (result.diagnostics?.responseBodyLength === 0 && result.httpStatus === 200) {
    return (
      "Empty panel response (HTTP 200) — R22F requires billing server IP in Settings > API IP's. " +
      "developer_username GET params are not used on classic v2 api.php."
    );
  }
  if (result.httpStatus >= 400) return `HTTP ${result.httpStatus}`;
  return "Request failed (see logs/xtream-sync.jsonl)";
}

async function executeRequest({ method, url, endpoint, body, logParams, apiMode }) {
  const config = {
    method,
    url,
    timeout: Number(process.env.XTREAM_REQUEST_TIMEOUT_MS || 20000),
    validateStatus: () => true,
    transformResponse: [(raw) => raw],
    headers: { Accept: "application/json, text/plain, */*" },
  };
  if (method === "POST" && body) {
    config.data = body;
    config.headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const response = await axios(config);
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
      method,
      apiMode,
    },
    request: {
      method,
      url: url.split("?")[0],
      endpoint,
      params: redactParams(logParams || {}),
    },
  };
}

async function billingGetRequest(action, sub, payload = {}) {
  const apiUrl = getApiUrl();
  const query = buildBillingQuery(action, sub, payload);
  const requestUrl = buildRequestUrl(apiUrl, query);
  return executeRequest({
    method: "GET",
    url: requestUrl,
    endpoint: buildFullEndpoint(apiUrl, query),
    logParams: query,
    apiMode: "billing",
  });
}

async function r22fGetRequest(action, sub, queryExtra = {}) {
  const apiUrl = getApiUrl();
  const query = { action, sub, ...queryExtra };
  const requestUrl = buildRequestUrl(apiUrl, query);
  return executeRequest({
    method: "GET",
    url: requestUrl,
    endpoint: buildFullEndpoint(apiUrl, query),
    logParams: query,
    apiMode: "r22f",
  });
}

async function r22fPostRequest(action, sub, payload = {}) {
  const apiUrl = getApiUrl();
  const query = { action, sub };
  const requestUrl = buildRequestUrl(apiUrl, query);
  const body = buildQueryString(buildV2PostBody(action, sub, payload));
  const logParams = { ...query, ...payload };
  return executeRequest({
    method: "POST",
    url: requestUrl,
    endpoint: buildFullEndpoint(apiUrl, logParams),
    body,
    logParams,
    apiMode: "r22f",
  });
}

async function apiRequest(action, sub, payload = {}, options = {}) {
  const mode = options.mode || getApiMode();
  const isReadOnly = options.readOnly === true;

  if (mode === "billing") {
    return billingGetRequest(action, sub, payload);
  }

  if (isReadOnly) {
    return r22fGetRequest(action, sub, payload);
  }

  return r22fPostRequest(action, sub, payload);
}

async function getBouquets(options) {
  const mode = options?.mode || getApiMode();
  if (mode === "auto") {
    const r22f = await r22fGetRequest("bouquet", "get");
    if (r22f.ok || (r22f.diagnostics?.responseBodyLength || 0) > 0) return r22f;
    return billingGetRequest("bouquet", "get");
  }
  return apiRequest("bouquet", "get", {}, { mode, readOnly: true });
}

async function getUserProfile(username, linePassword) {
  if (!username) throw new Error("getUserProfile requires username");
  const mode = getApiMode();
  if (mode === "billing") {
    return billingGetRequest("user", "get", { username: String(username).trim() });
  }
  if (!linePassword) throw new Error("getUserProfile requires line password in R22F mode (sub=info)");
  return r22fPostRequest("user", "info", {
    username: String(username).trim(),
    password: String(linePassword),
  });
}

async function createSubscriptionLine({ username, password, max_connections = 1, exp_date, bouquet }) {
  if (!username || !password) throw new Error("createSubscriptionLine requires username and password");
  const exp = Number(exp_date);
  if (!Number.isFinite(exp) || exp <= 0) {
    throw new Error("createSubscriptionLine requires exp_date as Unix epoch seconds");
  }
  const mode = getApiMode();
  const userData = {
    username: String(username).trim(),
    password: String(password),
    max_connections: Math.max(1, Math.floor(Number(max_connections) || 1)),
    exp_date: Math.floor(exp),
    bouquet: formatBouquetParam(bouquet),
    is_restreamer: Number(process.env.XTREAM_DEFAULT_IS_RESTREAMER || 0),
  };

  if (mode === "billing") {
    return billingGetRequest("user", "create", userData);
  }
  return r22fPostRequest("user", "create", { user_data: userData });
}

async function editSubscriptionLine({ username, password, exp_date, bouquet }) {
  if (!username) throw new Error("editSubscriptionLine requires username");
  const mode = getApiMode();
  const userData = {};
  if (exp_date != null) {
    const exp = Number(exp_date);
    if (!Number.isFinite(exp) || exp <= 0) {
      throw new Error("editSubscriptionLine exp_date must be a positive Unix epoch when provided");
    }
    userData.exp_date = Math.floor(exp);
  }
  if (bouquet != null) userData.bouquet = formatBouquetParam(bouquet);
  if (!Object.keys(userData).length) {
    throw new Error("editSubscriptionLine requires exp_date and/or bouquet");
  }

  if (mode === "billing") {
    return billingGetRequest("user", "edit", {
      username: String(username).trim(),
      ...userData,
    });
  }
  if (!password) throw new Error("editSubscriptionLine requires line password in R22F mode");
  return r22fPostRequest("user", "edit", {
    username: String(username).trim(),
    password: String(password),
    user_data: userData,
  });
}

async function disableSubscriptionLine(username, linePassword) {
  const u = String(username).trim();
  const mode = getApiMode();
  if (mode === "billing") return billingGetRequest("user", "disable", { username: u });
  if (linePassword) {
    return r22fPostRequest("user", "disable", { username: u, password: String(linePassword) });
  }
  return r22fGetRequest("user", "disable", { username: u });
}

async function enableSubscriptionLine(username, linePassword) {
  const u = String(username).trim();
  const mode = getApiMode();
  if (mode === "billing") return billingGetRequest("user", "enable", { username: u });
  if (linePassword) {
    return r22fPostRequest("user", "enable", { username: u, password: String(linePassword) });
  }
  return r22fGetRequest("user", "enable", { username: u });
}

/** Probe helpers for auth-probe script */
async function probeBouquetR22f() {
  return r22fGetRequest("bouquet", "get");
}

async function probeBouquetBilling() {
  return billingGetRequest("bouquet", "get");
}

module.exports = {
  getBaseUrl,
  getApiUrl,
  getApiMode,
  getDeveloperCredentials,
  readDeveloperPair,
  buildBillingQuery,
  buildDocQuery: buildBillingQuery,
  buildV2PostBody,
  parseResponseData,
  describeApiResult,
  buildFullEndpoint,
  buildRequestUrl,
  buildQueryString,
  formatBouquetParam,
  probeBouquetR22f,
  probeBouquetBilling,
  getBouquets,
  getUserProfile,
  createSubscriptionLine,
  editSubscriptionLine,
  disableSubscriptionLine,
  enableSubscriptionLine,
};
