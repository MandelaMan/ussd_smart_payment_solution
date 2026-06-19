const axios = require("axios");

function normalizeBaseUrl(raw) {
  const base = String(raw || "http://100.121.223.62:25500").trim();
  return base.replace(/\/+$/, "").replace(/\/api\.php$/i, "");
}

function getBaseUrl() {
  return normalizeBaseUrl(process.env.XTREAM_BASE_URL);
}

function getDeveloperCredentials() {
  const developer_username = String(
    process.env.XTREAM_DEVELOPER_USERNAME || ""
  ).trim();
  const developer_password = String(
    process.env.XTREAM_DEVELOPER_PASSWORD || ""
  ).trim();
  if (!developer_username || !developer_password) {
    throw new Error(
      "XTREAM_DEVELOPER_USERNAME and XTREAM_DEVELOPER_PASSWORD are required"
    );
  }
  return { developer_username, developer_password };
}

function redactParams(params) {
  const copy = { ...params };
  if (copy.developer_password) copy.developer_password = "[redacted]";
  if (copy.password) copy.password = "[redacted]";
  return copy;
}

/** Full GET URL including query string (passwords redacted). */
function buildFullEndpoint(url, params) {
  const redacted = redactParams(params);
  const u = new URL(url);
  for (const [key, value] of Object.entries(redacted)) {
    if (value != null && value !== "") {
      u.searchParams.set(key, String(value));
    }
  }
  return u.toString();
}

function parseResponseData(data) {
  if (data == null || data === "") {
    return {
      status: "error",
      message:
        "Empty response from panel API (check XTREAM_BASE_URL, firewall IP whitelist, and that API access is enabled in panel settings)",
    };
  }
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed) {
      return {
        status: "error",
        message:
          "Empty response from panel API (check XTREAM_BASE_URL, firewall IP whitelist, and that API access is enabled in panel settings)",
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
  if (Array.isArray(parsed)) return parsed.length >= 0;
  if (!parsed || typeof parsed !== "object") return false;
  const status = String(parsed.status || "").toLowerCase();
  if (status === "error") return false;
  return status === "success" || status === "ok";
}

function describeApiResult(result) {
  if (result.ok) return "success";
  const err = responseErrorMessage(result.data);
  if (err) return err;
  if (result.httpStatus >= 400) return `HTTP ${result.httpStatus}`;
  return "Request failed (see logs/xtream-sync.jsonl for full response)";
}

/**
 * Xtream UI R22 admin API — GET http://PANEL:PORT/api.php
 * Auth: developer_username + developer_password on every request.
 */
async function xtreamRequest(params) {
  const creds = getDeveloperCredentials();
  const url = `${getBaseUrl()}/api.php`;
  const query = { ...creds, ...params };

  const { data: rawData, status } = await axios.get(url, {
    params: query,
    timeout: Number(process.env.XTREAM_REQUEST_TIMEOUT_MS || 20000),
    validateStatus: () => true,
  });

  const data = parseResponseData(rawData);
  const endpoint = buildFullEndpoint(url, query);

  return {
    ok: status >= 200 && status < 300 && isSuccessResponse(data),
    httpStatus: status,
    endpoint,
    data,
    request: {
      method: "GET",
      url,
      endpoint,
      params: redactParams(query),
    },
  };
}

/** action=bouquet&sub=get */
async function getBouquets() {
  return xtreamRequest({ action: "bouquet", sub: "get" });
}

/** action=user&sub=create */
async function createSubscriptionLine({
  username,
  password,
  max_connections = 1,
  exp_date,
  bouquet,
}) {
  return xtreamRequest({
    action: "user",
    sub: "create",
    username,
    password,
    max_connections,
    exp_date,
    bouquet: JSON.stringify(bouquet),
  });
}

/** action=user&sub=edit */
async function editSubscriptionLine({ username, exp_date, bouquet }) {
  const params = {
    action: "user",
    sub: "edit",
    username,
    exp_date,
  };
  if (bouquet != null) {
    params.bouquet = JSON.stringify(bouquet);
  }
  return xtreamRequest(params);
}

/** action=user&sub=disable */
async function disableSubscriptionLine(username) {
  return xtreamRequest({
    action: "user",
    sub: "disable",
    username,
  });
}

/** action=user&sub=enable */
async function enableSubscriptionLine(username) {
  return xtreamRequest({
    action: "user",
    sub: "enable",
    username,
  });
}

module.exports = {
  getBaseUrl,
  getDeveloperCredentials,
  xtreamRequest,
  parseResponseData,
  describeApiResult,
  buildFullEndpoint,
  getBouquets,
  createSubscriptionLine,
  editSubscriptionLine,
  disableSubscriptionLine,
  enableSubscriptionLine,
};
