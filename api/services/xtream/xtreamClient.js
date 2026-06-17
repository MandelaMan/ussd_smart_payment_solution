"use strict";
const axios = require("axios");

const DEFAULT_BASE = "http://100.121.223.62:25500";

function getXtreamConfig() {
  const baseUrl = String(
    process.env.XTREAM_BASE_URL || DEFAULT_BASE
  ).replace(/\/+$/, "");
  return {
    baseUrl,
    apiPath: process.env.XTREAM_API_PATH || "/api.php",
    developerUsername: process.env.XTREAM_DEVELOPER_USERNAME || "",
    developerPassword: process.env.XTREAM_DEVELOPER_PASSWORD || "",
    timeoutMs: Number(process.env.XTREAM_TIMEOUT_MS || 20000),
  };
}

function apiUrl(cfg) {
  return `${cfg.baseUrl}${cfg.apiPath}`;
}

function authParams(cfg) {
  return buildAuthParams(cfg);
}

function encodeBouquet(bouquetIds) {
  const ids = Array.isArray(bouquetIds) ? bouquetIds : [bouquetIds];
  return JSON.stringify(ids.map((id) => Number(id)));
}

function parseXtreamBody(data) {
  if (data == null) return { raw: null, parseError: "empty_response" };
  if (typeof data === "object" && !Array.isArray(data)) return data;
  const text = String(data).trim();
  if (!text) return { raw: "", parseError: "empty_response" };
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 2000), parseError: "not_json" };
  }
}

function maskSecrets(query) {
  const out = { ...query };
  if (out.developer_password != null) out.developer_password = "***";
  if (out.password != null) out.password = "***";
  return out;
}

function buildAuthParams(cfg) {
  const username =
    cfg.developerUsername ||
    process.env.XTREAM_API_USERNAME ||
    "";
  const password =
    cfg.developerPassword ||
    process.env.XTREAM_API_PASSWORD ||
    "";
  return {
    developer_username: username,
    developer_password: password,
  };
}

function isSuccessResponse(body) {
  if (Array.isArray(body) && body.length > 0) return true;
  if (!body || typeof body !== "object") return false;
  const status = String(body.status || "").toLowerCase();
  return status === "success" || status === "true";
}

function isUsernameExistsError(body) {
  const msg = String(body?.message || body?.raw || "").toLowerCase();
  return msg.includes("username already exists") || msg.includes("already exist");
}

function isUserNotFoundError(body) {
  const msg = String(body?.message || body?.raw || "").toLowerCase();
  return msg.includes("user not found");
}

/**
 * @param {Record<string, string|number>} params
 */
async function xtreamRequest(params, cfg = getXtreamConfig()) {
  const auth = buildAuthParams(cfg);
  if (!auth.developer_username || !auth.developer_password) {
    throw new Error(
      "XTREAM_DEVELOPER_USERNAME and XTREAM_DEVELOPER_PASSWORD are required"
    );
  }
  const query = { ...auth, ...params };
  const method = String(process.env.XTREAM_HTTP_METHOD || "GET").toUpperCase();
  const started = Date.now();
  const url = apiUrl(cfg);

  const axiosCfg = {
    timeout: cfg.timeoutMs,
    validateStatus: () => true,
    responseType: "text",
    transformResponse: [(d) => d],
  };

  const res =
    method === "POST"
      ? await axios.post(url, null, { ...axiosCfg, params: query })
      : await axios.get(url, { ...axiosCfg, params: query });

  const rawText =
    res.data == null ? "" : String(res.data).trim();
  const body = parseXtreamBody(rawText);
  const contentType = String(res.headers?.["content-type"] || "");

  return {
    httpStatus: res.status,
    body,
    rawBody: rawText.slice(0, 2000),
    contentType,
    ok:
      res.status >= 200 &&
      res.status < 300 &&
      (isSuccessResponse(body) || (Array.isArray(body) && body.length > 0)),
    durationMs: Date.now() - started,
    request: maskSecrets(query),
    requestUrl: url,
    httpMethod: method,
    emptyBody: rawText.length === 0,
  };
}

async function getBouquets(cfg) {
  return xtreamRequest({ action: "bouquet", sub: "get" }, cfg);
}

async function createUser(
  { username, password, max_connections, exp_date, bouquet },
  cfg
) {
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
  const params = {
    action: "user",
    sub: "edit",
    username,
  };
  if (exp_date != null) params.exp_date = exp_date;
  if (max_connections != null) params.max_connections = max_connections;
  if (bouquet != null) params.bouquet = encodeBouquet(bouquet);
  return xtreamRequest(params, cfg);
}

async function disableUser(username, cfg) {
  return xtreamRequest({ action: "user", sub: "disable", username }, cfg);
}

async function enableUser(username, cfg) {
  return xtreamRequest({ action: "user", sub: "enable", username }, cfg);
}

function randomPassword(length = 10) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
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

module.exports = {
  getXtreamConfig,
  xtreamRequest,
  getBouquets,
  createUser,
  editUser,
  disableUser,
  enableUser,
  randomPassword,
  sanitizeUsername,
  futureExpDate,
  encodeBouquet,
  isSuccessResponse,
  isUsernameExistsError,
  isUserNotFoundError,
};
