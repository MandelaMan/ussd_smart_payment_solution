const axios = require("axios");

/**
 * Xtream UI R22 api.php — v2 billing doc (GET + developer_username/developer_password).
 * Base: http://PANEL_IP:ADMIN_PORT/api.php
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
  const status = String(parsed.status || "").toLowerCase();
  if (status === "error") return false;
  return status === "success" || status === "ok" || status === "true";
}

function responseErrorMessage(data) {
  const parsed = parseResponseData(data);
  if (Array.isArray(parsed)) return null;
  if (parsed && typeof parsed === "object") {
    const msg = parsed.message || parsed.error || parsed.msg;
    if (msg) return String(msg);
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
      "Empty panel response - whitelist billing server Tailscale IP 100.120.188.75 in panel API IP settings"
    );
  }
  if (result.httpStatus >= 400) return `HTTP ${result.httpStatus}`;
  return "Request failed (see logs/xtream-sync.jsonl)";
}

async function apiGet(action, sub, payload = {}) {
  const apiUrl = getApiUrl();
  const creds = getDeveloperCredentials();
  const query = {
    action,
    sub,
    developer_username: creds.developer_username,
    developer_password: creds.developer_password,
    ...payload,
  };
  const requestUrl = buildRequestUrl(apiUrl, query);
  const endpoint = buildFullEndpoint(apiUrl, query);

  const response = await axios.get(requestUrl, {
    timeout: Number(process.env.XTREAM_REQUEST_TIMEOUT_MS || 20000),
    validateStatus: () => true,
    transformResponse: [(raw) => raw],
    headers: { Accept: "application/json, text/plain, */*" },
  });

  const rawText = response.data == null ? "" : String(response.data);
  const data = parseResponseData(response.data);

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
      method: "GET",
    },
    request: {
      method: "GET",
      endpoint,
      params: redactParams(query),
    },
  };
}

async function getBouquets() {
  return apiGet("bouquet", "get");
}

async function createSubscriptionLine({ username, password, max_connections = 1, exp_date, bouquet }) {
  if (!username || !password) throw new Error("createSubscriptionLine requires username and password");
  const exp = Number(exp_date);
  if (!Number.isFinite(exp) || exp <= 0) {
    throw new Error("createSubscriptionLine requires exp_date as Unix epoch seconds");
  }
  return apiGet("user", "create", {
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
  if (bouquet != null) {
    payload.bouquet = formatBouquetParam(bouquet);
  }
  if (payload.exp_date == null && payload.bouquet == null) {
    throw new Error("editSubscriptionLine requires exp_date and/or bouquet");
  }
  return apiGet("user", "edit", payload);
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
  getBouquets,
  createSubscriptionLine,
  editSubscriptionLine,
  disableSubscriptionLine,
  enableSubscriptionLine,
};
