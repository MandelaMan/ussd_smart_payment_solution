const axios = require("axios");

/**
 * Xtream UI R22 / XUI api.php
 * - Reads (bouquet list): GET + query string per billing doc
 * - Writes (user create/edit/enable/disable): POST form body (XUI panels require this)
 *   Auth stays developer_username + developer_password (query string)
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
        "(panel Settings → General API gateway credentials; admin CMS port e.g. :25500)"
    );
  }
  return { developer_username, developer_password };
}

function getApiKey() {
  return String(process.env.XTREAM_API_KEY || "").trim();
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
  if (copy.api_key) copy.api_key = "[redacted]";
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

function buildRequestUrl(baseApiUrl, params) {
  const qs = buildQueryString(params);
  return qs ? `${baseApiUrl}?${qs}` : baseApiUrl;
}

function buildFullEndpoint(baseApiUrl, params) {
  const qs = buildQueryString(redactParams(params));
  return qs ? `${baseApiUrl}?${qs}` : baseApiUrl;
}

function buildAuthQuery(action, sub) {
  const q = { action, sub, ...getDeveloperCredentials() };
  const apiKey = getApiKey();
  if (apiKey) q.api_key = apiKey;
  return q;
}

function buildFormBody(payload, style = "flat") {
  const entries = Object.entries(payload).filter(
    ([, v]) => v != null && v !== ""
  );
  if (style === "user_data") {
    const sp = new URLSearchParams();
    for (const [key, value] of entries) {
      sp.append(`user_data[${key}]`, String(value));
    }
    return sp.toString();
  }
  return buildQueryString(Object.fromEntries(entries));
}

function parseResponseData(data) {
  if (data == null || data === "") {
    return {
      status: "error",
      message:
        "Empty response from panel API — enable API under Settings → General, verify credentials, whitelist billing server IP on admin port",
    };
  }
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed) {
      return {
        status: "error",
        message:
          "Empty response from panel API — enable API under Settings → General, verify credentials, whitelist billing server IP on admin port",
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
    if (lower.includes("exists") || lower.includes("already exists")) {
      return "Username already exists — use a unique line username";
    }
    if (lower.includes("user not found")) {
      return "User not found — verify username exists before edit/disable/enable";
    }
    if (lower.includes("parameter")) {
      return `Parameter error from panel: ${err}`;
    }
    return err;
  }
  if (result.httpStatus >= 400) return `HTTP ${result.httpStatus}`;
  return "Request failed (see logs/xtream-sync.jsonl for full response)";
}

async function executeHttpRequest({ method, url, endpoint, body, logParams }) {
  const config = {
    method,
    url,
    timeout: Number(process.env.XTREAM_REQUEST_TIMEOUT_MS || 20000),
    validateStatus: () => true,
    transformResponse: [(raw) => raw],
    headers: {
      Accept: "application/json, text/plain, */*",
    },
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
      postStyle: method === "POST" ? process.env.XTREAM_POST_STYLE || "flat" : null,
    },
    request: {
      method,
      url: url.split("?")[0],
      endpoint,
      params: redactParams(logParams),
      ...(method === "POST" && body
        ? { bodyPreview: redactParams(Object.fromEntries(new URLSearchParams(body))) }
        : {}),
    },
  };
}

/** GET — bouquet list and optional fallback reads */
async function xtreamGetRequest(params) {
  const apiUrl = `${getBaseUrl()}/api.php`;
  const query = { ...getDeveloperCredentials(), ...params };
  const apiKey = getApiKey();
  if (apiKey) query.api_key = apiKey;
  const requestUrl = buildRequestUrl(apiUrl, query);
  const endpoint = buildFullEndpoint(apiUrl, query);
  return executeHttpRequest({
    method: "GET",
    url: requestUrl,
    endpoint,
    logParams: query,
  });
}

/**
 * POST (default) for user mutations — XUI panels expect form POST, not GET.
 * Auth on query string; payload in x-www-form-urlencoded body.
 */
async function xtreamMutateRequest(action, sub, payload) {
  const apiUrl = `${getBaseUrl()}/api.php`;
  const method = String(process.env.XTREAM_USER_API_METHOD || "POST").toUpperCase();
  const postStyle = String(process.env.XTREAM_POST_STYLE || "flat").toLowerCase();

  const authQuery = buildAuthQuery(action, sub);

  if (method === "GET") {
    const query = { ...authQuery, ...payload };
    const requestUrl = buildRequestUrl(apiUrl, query);
    const endpoint = buildFullEndpoint(apiUrl, query);
    return executeHttpRequest({
      method: "GET",
      url: requestUrl,
      endpoint,
      logParams: query,
    });
  }

  const requestUrl = buildRequestUrl(apiUrl, authQuery);
  const endpoint = buildFullEndpoint(apiUrl, { ...authQuery, ...payload });
  const body = buildFormBody(payload, postStyle);

  let result = await executeHttpRequest({
    method: "POST",
    url: requestUrl,
    endpoint,
    body,
    logParams: { ...authQuery, ...payload },
  });

  const retryUserData =
    String(process.env.XTREAM_AUTO_RETRY_USER_DATA || "true").toLowerCase() !==
    "false";
  if (!result.ok && retryUserData && postStyle !== "user_data") {
    const altBody = buildFormBody(payload, "user_data");
    const altEndpoint = buildFullEndpoint(apiUrl, {
      ...authQuery,
      ...payload,
      _postStyle: "user_data",
    });
    const alt = await executeHttpRequest({
      method: "POST",
      url: requestUrl,
      endpoint: altEndpoint,
      body: altBody,
      logParams: { ...authQuery, ...payload, _postStyle: "user_data" },
    });
    if (alt.ok || Number(alt.diagnostics?.responseBodyLength || 0) > 0) {
      result = alt;
    }
  }

  return result;
}

async function getBouquets() {
  return xtreamGetRequest({ action: "bouquet", sub: "get" });
}

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

  const payload = {
    username: String(username).trim(),
    password: String(password),
    max_connections: Math.max(1, Math.floor(Number(max_connections) || 1)),
    exp_date: Math.floor(exp),
    bouquet: formatBouquetParam(bouquet),
    is_restreamer: Number(process.env.XTREAM_DEFAULT_IS_RESTREAMER || 0),
    is_trial: Number(process.env.XTREAM_DEFAULT_IS_TRIAL || 0),
  };

  return xtreamMutateRequest("user", "create", payload);
}

async function editSubscriptionLine({ username, exp_date, bouquet }) {
  if (!username) throw new Error("editSubscriptionLine requires username");
  const exp = Number(exp_date);
  if (!Number.isFinite(exp) || exp <= 0) {
    throw new Error("editSubscriptionLine requires exp_date as Unix epoch seconds");
  }
  const payload = {
    username: String(username).trim(),
    exp_date: Math.floor(exp),
  };
  if (bouquet != null) {
    payload.bouquet = formatBouquetParam(bouquet);
  }
  return xtreamMutateRequest("user", "edit", payload);
}

async function disableSubscriptionLine(username) {
  if (!username) throw new Error("disableSubscriptionLine requires username");
  return xtreamMutateRequest("user", "disable", {
    username: String(username).trim(),
  });
}

async function enableSubscriptionLine(username) {
  if (!username) throw new Error("enableSubscriptionLine requires username");
  return xtreamMutateRequest("user", "enable", {
    username: String(username).trim(),
  });
}

module.exports = {
  getBaseUrl,
  getDeveloperCredentials,
  parseResponseData,
  describeApiResult,
  buildFullEndpoint,
  buildRequestUrl,
  buildQueryString,
  buildFormBody,
  formatBouquetParam,
  getBouquets,
  createSubscriptionLine,
  editSubscriptionLine,
  disableSubscriptionLine,
  enableSubscriptionLine,
};
