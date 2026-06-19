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

function isSuccessResponse(data) {
  if (Array.isArray(data)) return true;
  if (!data || typeof data !== "object") return false;
  const status = String(data.status || "").toLowerCase();
  return status === "success" || status === "ok";
}

/**
 * Xtream UI R22 admin API — GET http://PANEL:PORT/api.php
 * Auth: developer_username + developer_password on every request.
 */
async function xtreamRequest(params) {
  const creds = getDeveloperCredentials();
  const url = `${getBaseUrl()}/api.php`;
  const query = { ...creds, ...params };

  const { data, status } = await axios.get(url, {
    params: query,
    timeout: Number(process.env.XTREAM_REQUEST_TIMEOUT_MS || 20000),
    validateStatus: () => true,
  });

  return {
    ok: status >= 200 && status < 300 && isSuccessResponse(data),
    httpStatus: status,
    data,
    request: {
      url,
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
  getBouquets,
  createSubscriptionLine,
  editSubscriptionLine,
  disableSubscriptionLine,
  enableSubscriptionLine,
};
