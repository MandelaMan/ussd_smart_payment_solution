/* eslint-disable no-console */
const axios = require("axios");

const DEFAULT_BASE_URL = "http://100.121.223.62:25500";

function getXtreamConfig() {
  const baseUrl = (process.env.XTREAM_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/$/,
    ""
  );
  return {
    baseUrl,
    apiUrl: `${baseUrl}/api.php`,
    developerUsername: process.env.XTREAM_DEVELOPER_USERNAME || "",
    developerPassword: process.env.XTREAM_DEVELOPER_PASSWORD || "",
    timeoutMs: Number(process.env.XTREAM_TIMEOUT_MS || 20_000),
  };
}

function authParams(cfg) {
  return {
    developer_username: cfg.developerUsername,
    developer_password: cfg.developerPassword,
  };
}

function normalizeBouquetParam(bouquetIds) {
  const ids = Array.isArray(bouquetIds) ? bouquetIds : [];
  return JSON.stringify(ids.map((id) => String(id)));
}

async function xtreamRequest(params, label = "xtream") {
  const cfg = getXtreamConfig();
  if (!cfg.developerUsername || !cfg.developerPassword) {
    const err = new Error(
      "XTREAM_DEVELOPER_USERNAME and XTREAM_DEVELOPER_PASSWORD are required"
    );
    err.code = "XTREAM_CONFIG";
    throw err;
  }

  const query = { ...authParams(cfg), ...params };
  const started = Date.now();
  const { data, status } = await axios.get(cfg.apiUrl, {
    params: query,
    timeout: cfg.timeoutMs,
    validateStatus: () => true,
  });

  return {
    label,
    httpStatus: status,
    durationMs: Date.now() - started,
    request: { url: cfg.apiUrl, params: { ...query, developer_password: "***" } },
    data,
    ok: status >= 200 && status < 300,
  };
}

function responseIndicatesSuccess(data) {
  if (Array.isArray(data)) return true;
  if (data && typeof data === "object") {
    const status = String(data.status || "").toLowerCase();
    if (status === "success") return true;
    if (status === "error") return false;
  }
  return true;
}

function responseMessage(data) {
  if (Array.isArray(data)) return `array(${data.length})`;
  if (data && typeof data === "object") {
    return String(data.message || data.status || JSON.stringify(data));
  }
  return String(data ?? "");
}

/** action=bouquet&sub=get */
async function getBouquets() {
  const res = await xtreamRequest(
    { action: "bouquet", sub: "get" },
    "bouquet.get"
  );
  return {
    ...res,
    success: res.ok && responseIndicatesSuccess(res.data),
    message: responseMessage(res.data),
  };
}

/** action=user&sub=create */
async function createUser({
  username,
  password,
  maxConnections = 1,
  expDate,
  bouquetIds = [],
}) {
  const res = await xtreamRequest(
    {
      action: "user",
      sub: "create",
      username,
      password,
      max_connections: maxConnections,
      exp_date: expDate,
      bouquet: normalizeBouquetParam(bouquetIds),
    },
    "user.create"
  );
  return {
    ...res,
    success: res.ok && responseIndicatesSuccess(res.data),
    message: responseMessage(res.data),
  };
}

/** action=user&sub=edit */
async function editUser({ username, expDate, bouquetIds = [] }) {
  const res = await xtreamRequest(
    {
      action: "user",
      sub: "edit",
      username,
      exp_date: expDate,
      bouquet: normalizeBouquetParam(bouquetIds),
    },
    "user.edit"
  );
  return {
    ...res,
    success: res.ok && responseIndicatesSuccess(res.data),
    message: responseMessage(res.data),
  };
}

/** action=user&sub=disable */
async function disableUser({ username }) {
  const res = await xtreamRequest(
    { action: "user", sub: "disable", username },
    "user.disable"
  );
  return {
    ...res,
    success: res.ok && responseIndicatesSuccess(res.data),
    message: responseMessage(res.data),
  };
}

/** action=user&sub=enable */
async function enableUser({ username }) {
  const res = await xtreamRequest(
    { action: "user", sub: "enable", username },
    "user.enable"
  );
  return {
    ...res,
    success: res.ok && responseIndicatesSuccess(res.data),
    message: responseMessage(res.data),
  };
}

function isUsernameExistsError(result) {
  const msg = String(result?.message || result?.data?.message || "").toLowerCase();
  return msg.includes("username already exists");
}

function isUserNotFoundError(result) {
  const msg = String(result?.message || result?.data?.message || "").toLowerCase();
  return msg.includes("user not found");
}

module.exports = {
  getXtreamConfig,
  getBouquets,
  createUser,
  editUser,
  disableUser,
  enableUser,
  isUsernameExistsError,
  isUserNotFoundError,
  normalizeBouquetParam,
};
