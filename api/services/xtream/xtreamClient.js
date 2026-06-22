"use strict";

const axios = require("axios");

const DEFAULT_BASE = "http://100.121.223.62:25500";

function getXtreamConfig() {
  const baseUrl = String(process.env.XTREAM_BASE_URL || DEFAULT_BASE)
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api\.php$/i, "");
  return {
    baseUrl,
    apiPath: process.env.XTREAM_API_PATH || "/api.php",
    developerUsername: String(process.env.XTREAM_DEVELOPER_USERNAME || "").trim(),
    developerPassword: String(process.env.XTREAM_DEVELOPER_PASSWORD || "").trim(),
    timeoutMs: Number(
      process.env.XTREAM_TIMEOUT_MS || process.env.XTREAM_REQUEST_TIMEOUT_MS || 20000
    ),
  };
}

function apiUrl(cfg = getXtreamConfig()) {
  return `${cfg.baseUrl}${cfg.apiPath}`;
}

function authParams(cfg) {
  return {
    developer_username: cfg.developerUsername,
    developer_password: cfg.developerPassword,
  };
}

function encodeBouquet(bouquetIds) {
  const ids = (Array.isArray(bouquetIds) ? bouquetIds : [bouquetIds])
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

function buildFullEndpoint(cfg, params) {
  const qs = Object.entries(redactParams(params))
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const base = apiUrl(cfg);
  return qs ? `${base}?${qs}` : base;
}

function parseXtreamBody(data) {
  if (data == null || data === "") return { raw: null, status: "error", message: "Empty panel response" };
  if (typeof data === "object") return data;
  const text = String(data).trim();
  if (!text) return { raw: text, status: "error", message: "Empty panel response" };
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function isSuccessResponse(body) {
  if (Array.isArray(body)) return true;
  if (!body || typeof body !== "object") return false;
  if (body.result === true || body.result === "true") return true;
  if (body.id != null && body.username) return true;
  const status = String(body.status || "").toLowerCase();
  if (status === "error") return false;
  return status === "success" || status === "ok" || status === "true";
}

function isUsernameExistsError(body) {
  const msg = String(body?.message || body?.raw || "").toLowerCase();
  return msg.includes("username already exists") || msg.includes("already exist");
}

function isUserNotFoundError(body) {
  const msg = String(body?.message || body?.raw || "").toLowerCase();
  return msg.includes("user not found");
}

function responseErrorMessage(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (body.result === false && body.error) return String(body.error);
  const msg = body.message || body.error || body.msg;
  if (msg) return String(msg);
  if (body.status === "error") return JSON.stringify(body);
  return null;
}

function describeApiResult(result) {
  if (result.ok) return "success";
  const err = responseErrorMessage(result.body || result.data);
  if (err) return err;
  if (result.diagnostics?.responseBodyLength === 0) {
    return "Empty panel response — check XTREAM_BASE_URL (Tailscale IP) and developer credentials";
  }
  if (result.httpStatus >= 400) return `HTTP ${result.httpStatus}`;
  return "Request failed (see logs/xtream-sync.jsonl)";
}

/**
 * GET api.php — matches original working client: auth params + action params via axios `params`.
 */
async function xtreamRequest(params, cfg = getXtreamConfig()) {
  if (!cfg.developerUsername || !cfg.developerPassword) {
    throw new Error("XTREAM_DEVELOPER_USERNAME and XTREAM_DEVELOPER_PASSWORD are required");
  }
  const query = { ...authParams(cfg), ...params };
  const started = Date.now();
  const response = await axios.get(apiUrl(cfg), {
    params: query,
    timeout: cfg.timeoutMs,
    validateStatus: () => true,
  });
  const rawText = response.data == null ? "" : String(response.data);
  const body = parseXtreamBody(response.data);
  const endpoint = buildFullEndpoint(cfg, query);

  return {
    httpStatus: response.status,
    body,
    data: body,
    ok: response.status >= 200 && response.status < 300 && isSuccessResponse(body),
    durationMs: Date.now() - started,
    endpoint,
    diagnostics: {
      responseBodyLength: rawText.length,
      contentType: response.headers["content-type"] || null,
      method: "GET",
    },
    request: {
      method: "GET",
      url: apiUrl(cfg),
      endpoint,
      params: redactParams(query),
    },
  };
}

async function getBouquets(cfg) {
  return xtreamRequest({ action: "bouquet", sub: "get" }, cfg);
}

async function createUser({ username, password, max_connections, exp_date, bouquet }, cfg) {
  return xtreamRequest(
    {
      action: "user",
      sub: "create",
      username,
      password,
      max_connections,
      exp_date,
      bouquet: encodeBouquet(bouquet),
    },
    cfg
  );
}

async function editUser({ username, exp_date, bouquet, max_connections }, cfg) {
  const params = { action: "user", sub: "edit", username };
  if (exp_date != null) params.exp_date = exp_date;
  if (max_connections != null) params.max_connections = max_connections;
  if (bouquet != null) params.bouquet = encodeBouquet(bouquet);
  return xtreamRequest(params, cfg);
}

async function getUserProfile(username, cfg) {
  return xtreamRequest({ action: "user", sub: "get", username }, cfg);
}

async function disableUser(username, cfg) {
  return xtreamRequest({ action: "user", sub: "disable", username }, cfg);
}

async function enableUser(username, cfg) {
  return xtreamRequest({ action: "user", sub: "enable", username }, cfg);
}

function randomPassword(length = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function sanitizeUsername(customerNumber) {
  return String(customerNumber || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
}

function futureExpDate(days = 30) {
  const secs = Math.max(1, Number(days) || 30) * 86400;
  return Math.floor(Date.now() / 1000) + secs;
}

function getDeveloperCredentials() {
  const cfg = getXtreamConfig();
  if (!cfg.developerUsername || !cfg.developerPassword) {
    throw new Error("XTREAM_DEVELOPER_USERNAME and XTREAM_DEVELOPER_PASSWORD are required");
  }
  return {
    developer_username: cfg.developerUsername,
    developer_password: cfg.developerPassword,
  };
}

function getBaseUrl() {
  return getXtreamConfig().baseUrl;
}

function getApiUrl() {
  return apiUrl();
}

function readDeveloperPair() {
  const cfg = getXtreamConfig();
  return {
    developer_username: cfg.developerUsername,
    developer_password: cfg.developerPassword,
  };
}

module.exports = {
  getXtreamConfig,
  getBaseUrl,
  getApiUrl,
  getDeveloperCredentials,
  readDeveloperPair,
  xtreamRequest,
  getBouquets,
  getUserProfile,
  createUser,
  editUser,
  disableUser,
  enableUser,
  createSubscriptionLine: createUser,
  editSubscriptionLine: editUser,
  disableSubscriptionLine: disableUser,
  enableSubscriptionLine: enableUser,
  randomPassword,
  sanitizeUsername,
  futureExpDate,
  encodeBouquet,
  formatBouquetParam: encodeBouquet,
  parseXtreamBody,
  parseResponseData: parseXtreamBody,
  describeApiResult,
  buildFullEndpoint,
  isSuccessResponse,
  isUsernameExistsError,
  isUserNotFoundError,
};
