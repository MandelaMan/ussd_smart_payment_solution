const axios = require("axios");

/**
 * Xtream UI R22 Backend API (api.php)
 * Spec: query-string GET to http://PANEL:ADMIN_PORT/api.php
 *
 * Auth (every call): developer_username, developer_password
 * Bouquet list: action=bouquet&sub=get → JSON array
 * Create line: action=user&sub=create + username, password, max_connections, exp_date, bouquet
 * Renew/edit: action=user&sub=edit + username, exp_date, bouquet
 * Disable: action=user&sub=disable + username
 * Enable: action=user&sub=enable + username
 */

function normalizeBaseUrl(raw) {
  const base = String(raw || "http://100.121.223.62:25500").trim();
  return base.replace(/\/+$/, "").replace(/\/api\.php$/i, "");
}

function getBaseUrl() {
  return normalizeBaseUrl(process.env.XTREAM_BASE_URL);
}

function getDeveloperCredentials() {
  const developer_username = String(
    process.env.XTREAM_DEVELOPER_USERNAME ||
      process.env.XTREAM_ADMIN_USERNAME ||
      ""
  ).trim();
  const developer_password = String(
    process.env.XTREAM_DEVELOPER_PASSWORD ||
      process.env.XTREAM_ADMIN_PASSWORD ||
      ""
  ).trim();
  if (!developer_username || !developer_password) {
    throw new Error(
      "XTREAM_DEVELOPER_USERNAME and XTREAM_DEVELOPER_PASSWORD are required " +
        "(panel Settings → General API gateway credentials; same admin port as CMS, e.g. :25500)"
    );
  }
  return { developer_username, developer_password };
}

/** Doc: bouquet = URL-encoded JSON array of integer bouquet IDs, e.g. [1,2] */
function formatBouquetParam(bouquet) {
  const ids = (Array.isArray(bouquet) ? bouquet : [bouquet])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) {
    throw new Error("bouquet must contain at least one valid integer ID");
  }
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
    parts.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
    );
  }
  return parts.join("&");
}

/** Live request URL — real credentials (never log this string). */
function buildRequestUrl(baseApiUrl, params) {
  const qs = buildQueryString(params);
  return qs ? `${baseApiUrl}?${qs}` : baseApiUrl;
}

/** Log-safe URL — passwords replaced with [redacted]. */
function buildFullEndpoint(baseApiUrl, params) {
  const qs = buildQueryString(redactParams(params));
  return qs ? `${baseApiUrl}?${qs}` : baseApiUrl;
}

function parseResponseData(data) {
  if (data == null || data === "") {
    return {
      status: "error",
      message:
        "Empty response from panel API — enable API under Settings → General, verify developer_username/developer_password, and whitelist billing server IP on admin port",
    };
  }
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed) {
      return {
        status: "error",
        message:
          "Empty response from panel API — enable API under Settings → General, verify developer_username/developer_password, and whitelist billing server IP on admin port",
      };
    }
    if (trimmed.startsWith("<")) {
      return {
        status: "error",
        message: "HTML response from panel (wrong endpoint or not API JSON)",
        raw: trimmed.slice(0, 300),
      };
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return {
        status: "error",
        message: "Non-JSON response from panel API",
        raw: trimmed.slice(0, 300),
      };
    }
  }
  return data;
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

function isSuccessResponse(data) {
  const parsed = parseResponseData(data);
  if (Array.isArray(parsed)) return true;
  if (!parsed || typeof parsed !== "object") return false;
  const status = String(parsed.status || "").toLowerCase();
  if (status === "error") return false;
  return status === "success" || status === "ok";
}

function describeApiResult(result) {
  if (result.ok) return "success";
  const err = responseErrorMessage(result.data);
  if (err) {
    const lower = err.toLowerCase();
    if (lower.includes("access denied")) {
      return "Access denied — check API enabled (Settings → General) and developer credentials";
    }
    if (lower.includes("username already exists")) {
      return "Username already exists — use a unique line username";
    }
    if (lower.includes("user not found")) {
      return "User not found — verify username exists before edit/disable/enable";
    }
    return err;
  }
  if (result.httpStatus >= 400) return `HTTP ${result.httpStatus}`;
  return "Request failed (see logs/xtream-sync.jsonl for full response)";
}

/**
 * GET http://PANEL:PORT/api.php?... per Xtream UI R22 spec (all params in query string).
 */
async function xtreamRequest(params) {
  const creds = getDeveloperCredentials();
  const apiUrl = `${getBaseUrl()}/api.php`;
  const query = { ...creds, ...params };
  const requestUrl = buildRequestUrl(apiUrl, query);
  const endpoint = buildFullEndpoint(apiUrl, query);

  const response = await axios.get(requestUrl, {
    timeout: Number(process.env.XTREAM_REQUEST_TIMEOUT_MS || 20000),
    validateStatus: () => true,
    transformResponse: [(body) => body],
    headers: {
      Accept: "application/json, text/plain, */*",
    },
  });
  const rawData = response.data;
  const data = parseResponseData(rawData);
  const rawText = rawData == null ? "" : String(rawData);

  return {
    ok: response.status >= 200 && response.status < 300 && isSuccessResponse(data),
    httpStatus: response.status,
    endpoint,
    data,
    diagnostics: {
      responseBodyLength: rawText.length,
      contentType: response.headers["content-type"] || null,
      passwordConfigured: Boolean(creds.developer_password),
    },
    request: {
      method: "GET",
      url: apiUrl,
      endpoint,
      params: redactParams(query),
    },
  };
}

/** action=bouquet&sub=get */
async function getBouquets() {
  return xtreamRequest({ action: "bouquet", sub: "get" });
}

/** action=user&sub=create — all keys required by spec */
async function createSubscriptionLine({
  username,
  password,
  max_connections = 1,
  exp_date,
  bouquet,
}) {
  if (!username || !password) {
    throw new Error("createSubscriptionLine requires username and password");
  }
  const exp = Number(exp_date);
  if (!Number.isFinite(exp) || exp <= 0) {
    throw new Error("createSubscriptionLine requires exp_date as Unix epoch seconds");
  }
  return xtreamRequest({
    action: "user",
    sub: "create",
    username: String(username).trim(),
    password: String(password),
    max_connections: Math.max(1, Math.floor(Number(max_connections) || 1)),
    exp_date: Math.floor(exp),
    bouquet: formatBouquetParam(bouquet),
  });
}

/** action=user&sub=edit */
async function editSubscriptionLine({ username, exp_date, bouquet }) {
  if (!username) throw new Error("editSubscriptionLine requires username");
  const exp = Number(exp_date);
  if (!Number.isFinite(exp) || exp <= 0) {
    throw new Error("editSubscriptionLine requires exp_date as Unix epoch seconds");
  }
  const params = {
    action: "user",
    sub: "edit",
    username: String(username).trim(),
    exp_date: Math.floor(exp),
  };
  if (bouquet != null) {
    params.bouquet = formatBouquetParam(bouquet);
  }
  return xtreamRequest(params);
}

/** action=user&sub=disable */
async function disableSubscriptionLine(username) {
  if (!username) throw new Error("disableSubscriptionLine requires username");
  return xtreamRequest({
    action: "user",
    sub: "disable",
    username: String(username).trim(),
  });
}

/** action=user&sub=enable */
async function enableSubscriptionLine(username) {
  if (!username) throw new Error("enableSubscriptionLine requires username");
  return xtreamRequest({
    action: "user",
    sub: "enable",
    username: String(username).trim(),
  });
}

module.exports = {
  getBaseUrl,
  getDeveloperCredentials,
  xtreamRequest,
  parseResponseData,
  describeApiResult,
  buildFullEndpoint,
  buildRequestUrl,
  buildQueryString,
  formatBouquetParam,
  getBouquets,
  createSubscriptionLine,
  editSubscriptionLine,
  disableSubscriptionLine,
  enableSubscriptionLine,
};
