const axios = require("axios");

/**
 * Xtream api.php — billing doc (GET + developer_*) with R22F v2 fallback (POST user_data).
 * Panel: http://TAILSCALE_IP:25500/api.php (same droplet, not public internet).
 * Mode: XTREAM_API_MODE=auto|billing|v2  (default auto)
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
  return String(process.env.XTREAM_API_MODE || "auto").toLowerCase();
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

function hasDeveloperCreds() {
  const p = readDeveloperPair();
  return Boolean(p.developer_username && p.developer_password);
}

function getDeveloperCredentials() {
  const pair = readDeveloperPair();
  if (!pair.developer_username || !pair.developer_password) {
    throw new Error(
      "XTREAM_DEVELOPER_USERNAME and XTREAM_DEVELOPER_PASSWORD are required for billing mode"
    );
  }
  return pair;
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

function flattenUserData(data) {
  const body = {};
  for (const [key, value] of Object.entries(data)) {
    if (value == null || value === "") continue;
    body[`user_data[${key}]`] = String(value);
  }
  return body;
}

function buildV2PostBody({ username, password, user_data: userData, ...rest } = {}) {
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
      message: "Empty panel response",
    };
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
  if (result.diagnostics?.responseBodyLength === 0) {
    return (
      "Empty panel response — check API IP's in panel Settings, developer credentials, " +
      "and XTREAM_BASE_URL (Tailscale IP e.g. http://100.121.223.62:25500/)."
    );
  }
  if (result.httpStatus >= 400) return `HTTP ${result.httpStatus}`;
  return "Request failed (see logs/xtream-sync.jsonl)";
}

function hasUsefulBody(result) {
  return (result.diagnostics?.responseBodyLength || 0) > 0;
}

async function executeRequest({ method, url, endpoint, body, logParams, transport }) {
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
      method,
      transport,
    },
    request: {
      method,
      url: url.split("?")[0],
      endpoint,
      params: redactParams(logParams || {}),
    },
  };
}

async function billingGet(action, sub, payload = {}) {
  const apiUrl = getApiUrl();
  const query = buildBillingQuery(action, sub, payload);
  const requestUrl = buildRequestUrl(apiUrl, query);
  return executeRequest({
    method: "GET",
    url: requestUrl,
    endpoint: buildFullEndpoint(apiUrl, query),
    logParams: query,
    transport: "billing-get",
  });
}

async function v2Get(action, sub, queryExtra = {}) {
  const apiUrl = getApiUrl();
  const query = { action, sub, ...queryExtra };
  const requestUrl = buildRequestUrl(apiUrl, query);
  return executeRequest({
    method: "GET",
    url: requestUrl,
    endpoint: buildFullEndpoint(apiUrl, query),
    logParams: query,
    transport: "v2-get",
  });
}

async function v2Post(action, sub, payload = {}) {
  const apiUrl = getApiUrl();
  const query = { action, sub };
  const requestUrl = buildRequestUrl(apiUrl, query);
  const body = buildQueryString(buildV2PostBody(payload));
  return executeRequest({
    method: "POST",
    url: requestUrl,
    endpoint: buildFullEndpoint(apiUrl, { ...query, ...payload }),
    body,
    logParams: { ...query, ...payload },
    transport: "v2-post",
  });
}

async function runStrategies(strategies) {
  const mode = getApiMode();
  let last;
  for (const { when, run, label } of strategies) {
    if (when === false) continue;
    if (mode === "billing" && !label.startsWith("billing")) continue;
    if (mode === "v2" && !label.startsWith("v2")) continue;
    last = await run();
    if (last.ok || hasUsefulBody(last)) {
      last.diagnostics = { ...last.diagnostics, usedTransport: label };
      return last;
    }
  }
  if (last) last.diagnostics = { ...last.diagnostics, usedTransport: "none" };
  return (
    last || {
      ok: false,
      httpStatus: 0,
      endpoint: getApiUrl(),
      data: { status: "error", message: "No API transport matched" },
      diagnostics: { responseBodyLength: 0, usedTransport: "none" },
    }
  );
}

async function getBouquets() {
  return runStrategies([
    {
      label: "billing-get",
      when: hasDeveloperCreds(),
      run: () => billingGet("bouquet", "get"),
    },
    { label: "v2-get", when: true, run: () => v2Get("bouquet", "get") },
  ]);
}

async function getUserProfile(username, linePassword) {
  if (!username) throw new Error("getUserProfile requires username");
  const u = String(username).trim();
  return runStrategies([
    {
      label: "billing-get",
      when: hasDeveloperCreds(),
      run: () => billingGet("user", "get", { username: u }),
    },
    {
      label: "v2-post-info",
      when: Boolean(linePassword),
      run: () => v2Post("user", "info", { username: u, password: String(linePassword) }),
    },
  ]);
}

async function createSubscriptionLine({ username, password, max_connections = 1, exp_date, bouquet }) {
  if (!username || !password) throw new Error("createSubscriptionLine requires username and password");
  const exp = Number(exp_date);
  if (!Number.isFinite(exp) || exp <= 0) {
    throw new Error("createSubscriptionLine requires exp_date as Unix epoch seconds");
  }
  const userData = {
    username: String(username).trim(),
    password: String(password),
    max_connections: Math.max(1, Math.floor(Number(max_connections) || 1)),
    exp_date: Math.floor(exp),
    bouquet: formatBouquetParam(bouquet),
  };
  return runStrategies([
    {
      label: "billing-get",
      when: hasDeveloperCreds(),
      run: () => billingGet("user", "create", userData),
    },
    {
      label: "v2-post",
      when: true,
      run: () => v2Post("user", "create", { user_data: userData }),
    },
  ]);
}

async function editSubscriptionLine({ username, password, exp_date, bouquet }) {
  if (!username) throw new Error("editSubscriptionLine requires username");
  const u = String(username).trim();
  const billingPayload = { username: u };
  const userData = {};
  if (exp_date != null) {
    const exp = Number(exp_date);
    if (!Number.isFinite(exp) || exp <= 0) {
      throw new Error("editSubscriptionLine exp_date must be a positive Unix epoch when provided");
    }
    billingPayload.exp_date = Math.floor(exp);
    userData.exp_date = Math.floor(exp);
  }
  if (bouquet != null) {
    const b = formatBouquetParam(bouquet);
    billingPayload.bouquet = b;
    userData.bouquet = b;
  }
  if (billingPayload.exp_date == null && billingPayload.bouquet == null) {
    throw new Error("editSubscriptionLine requires exp_date and/or bouquet");
  }
  return runStrategies([
    {
      label: "billing-get",
      when: hasDeveloperCreds(),
      run: () => billingGet("user", "edit", billingPayload),
    },
    {
      label: "v2-post",
      when: Boolean(password),
      run: () => v2Post("user", "edit", { username: u, password: String(password), user_data: userData }),
    },
  ]);
}

async function disableSubscriptionLine(username, linePassword) {
  const u = String(username).trim();
  return runStrategies([
    {
      label: "billing-get",
      when: hasDeveloperCreds(),
      run: () => billingGet("user", "disable", { username: u }),
    },
    { label: "v2-get", when: true, run: () => v2Get("user", "disable", { username: u }) },
    {
      label: "v2-post",
      when: Boolean(linePassword),
      run: () => v2Post("user", "disable", { username: u, password: String(linePassword) }),
    },
  ]);
}

async function enableSubscriptionLine(username, linePassword) {
  const u = String(username).trim();
  return runStrategies([
    {
      label: "billing-get",
      when: hasDeveloperCreds(),
      run: () => billingGet("user", "enable", { username: u }),
    },
    { label: "v2-get", when: true, run: () => v2Get("user", "enable", { username: u }) },
    {
      label: "v2-post",
      when: Boolean(linePassword),
      run: () => v2Post("user", "enable", { username: u, password: String(linePassword) }),
    },
  ]);
}

module.exports = {
  getBaseUrl,
  getApiUrl,
  getApiMode,
  getDeveloperCredentials,
  readDeveloperPair,
  hasDeveloperCreds,
  buildBillingQuery,
  buildDocQuery: buildBillingQuery,
  buildV2PostBody,
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
