const axios = require("axios");
const { logApiCall } = require("../utils/apiCallLogger");

const OLT_EMS_BASE_URL = (process.env.OLT_EMS_BASE_URL || "").replace(/\/$/, "");
const OLT_EMS_USERNAME = process.env.OLT_EMS_USERNAME || "";
const OLT_EMS_PASSWORD = process.env.OLT_EMS_PASSWORD || "";
const OLT_EMS_TENANT_ID = process.env.OLT_EMS_TENANT_ID || "000000";
const OLT_EMS_DEFAULT_MAC = process.env.OLT_EMS_DEFAULT_MAC || "";
const OLT_EMS_TIMEOUT_MS = Number(process.env.OLT_EMS_TIMEOUT_MS || 30_000);

const ACTION_REBOOT = 1;
const ACTION_DELETE = 2;
const ACTION_ACTIVATE = 3;
const ACTION_DEACTIVATE = 4;

let tokenCache = { token: null, expiresAt: 0 };

function isOltEmsConfigured() {
  return Boolean(OLT_EMS_BASE_URL && OLT_EMS_USERNAME && OLT_EMS_PASSWORD);
}

function isEmsSuccess(body) {
  return body && Number(body.code) === 200;
}

function resolveOltBinding(record = {}) {
  const mac =
    String(record.olt_mac || record.oltMac || OLT_EMS_DEFAULT_MAC || "").trim();
  const indexStr = String(
    record.onu_index_str || record.onuIndexStr || ""
  ).trim();
  const sn = String(record.onu_sn || record.onuSn || "").trim();
  return { mac, indexStr, sn };
}

function buildIndexStrFromOnu(onu) {
  if (!onu) return "";
  const slot = onu.authSlot ?? onu.auth_slot ?? 0;
  const ponType = onu.authPonType ?? onu.auth_pon_type ?? 1;
  const pon = onu.authPon ?? onu.auth_pon ?? 1;
  const onuIndex = onu.authOnu ?? onu.auth_onu;
  if (onuIndex == null) return "";
  return `0-${slot}-${ponType}-${pon}-${onuIndex}`;
}

async function login(force = false) {
  if (!isOltEmsConfigured()) {
    throw new Error("OLT EMS is not configured");
  }
  if (!force && tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const url = `${OLT_EMS_BASE_URL}/emsWebServer/login`;
  const payload = {
    username: OLT_EMS_USERNAME,
    password: OLT_EMS_PASSWORD,
    tenantId: OLT_EMS_TENANT_ID,
  };

  const response = await axios.post(url, payload, {
    timeout: OLT_EMS_TIMEOUT_MS,
    validateStatus: () => true,
  });

  await logApiCall({
    service: "olt",
    operation: "login",
    method: "POST",
    endpoint: url,
    status: isEmsSuccess(response.data) ? "success" : "failed",
    httpStatus: response.status,
    requestPayload: { username: OLT_EMS_USERNAME, tenantId: OLT_EMS_TENANT_ID },
    responsePayload: response.data,
    errorMessage: isEmsSuccess(response.data)
      ? null
      : response.data?.message || "OLT EMS login failed",
    retryable: true,
  });

  if (!isEmsSuccess(response.data)) {
    throw new Error(response.data?.message || "OLT EMS login failed");
  }

  const token = response.data?.data?.token;
  if (!token) {
    throw new Error("OLT EMS login returned no token");
  }

  tokenCache = {
    token,
    expiresAt: Date.now() + 50 * 60 * 1000,
  };
  return token;
}

async function emsRequest({
  method = "GET",
  path,
  params = {},
  data = undefined,
  operation,
  customerId = null,
  customerNumber = null,
  retryOnAuth = true,
}) {
  const token = await login();
  const url = `${OLT_EMS_BASE_URL}${path}`;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") {
      query.set(key, String(value));
    }
  }
  const fullUrl = query.toString() ? `${url}?${query.toString()}` : url;

  const response = await axios({
    method,
    url: fullUrl,
    data,
    headers: {
      Authorization: token,
      Accept: "application/json",
      ...(data != null ? { "Content-Type": "application/json" } : {}),
    },
    timeout: OLT_EMS_TIMEOUT_MS,
    validateStatus: () => true,
  });

  const ok = isEmsSuccess(response.data);
  await logApiCall({
    service: "olt",
    operation,
    method,
    endpoint: fullUrl,
    status: ok ? "success" : "failed",
    httpStatus: response.status,
    requestPayload: { params, data },
    responsePayload: response.data,
    errorMessage: ok ? null : response.data?.message || "OLT EMS request failed",
    customerId,
    customerNumber,
    retryable: true,
  });

  if (response.status === 401 && retryOnAuth) {
    tokenCache = { token: null, expiresAt: 0 };
    return emsRequest({
      method,
      path,
      params,
      data,
      operation,
      customerId,
      customerNumber,
      retryOnAuth: false,
    });
  }

  if (!ok) {
    throw new Error(response.data?.message || "OLT EMS request failed");
  }

  return response.data;
}

async function getOnuList({
  oltMac = OLT_EMS_DEFAULT_MAC,
  portIndex = 1,
  indexStr = "0-0-1-1-0",
} = {}) {
  const body = await emsRequest({
    path: "/emsWebServer/onuAuthList/getOnuAuthListInfos",
    params: { oltMac, portIndex, indexStr },
    operation: "get_onu_list",
  });
  return body.data || [];
}

async function getOnuAbility({
  oltMac = OLT_EMS_DEFAULT_MAC,
  portIndex = 1,
  onuIndex = 1,
  slotIndex = 0,
  onuProfileName = "default",
  indexStr,
} = {}) {
  const body = await emsRequest({
    method: "POST",
    path: "/emsWebServer/gonuPriConfig/getPriOnuInfo",
    params: {
      oltMac,
      portIndex,
      onuIndex,
      slotIndex,
      onuProfileName,
      indexStr,
    },
    operation: "get_onu_ability",
  });
  return body.data;
}

async function setOnuAdminStatus({
  oltMac,
  indexStr,
  action,
  customerId = null,
  customerNumber = null,
}) {
  const body = await emsRequest({
    path: "/emsWebServer/onuAuthList/setOperationOnu",
    params: {
      oltMac,
      indexStr,
      action,
    },
    operation:
      action === ACTION_ACTIVATE
        ? "activate_onu"
        : action === ACTION_DEACTIVATE
          ? "deactivate_onu"
          : `onu_action_${action}`,
    customerId,
    customerNumber,
  });
  return body;
}

async function activateOnuForCustomer(record, meta = {}) {
  if (!isOltEmsConfigured()) {
    return { ok: true, skipped: true, reason: "olt_not_configured" };
  }
  const { mac, indexStr } = resolveOltBinding(record);
  if (!mac || !indexStr) {
    return { ok: true, skipped: true, reason: "no_onu_mapping" };
  }
  try {
    await setOnuAdminStatus({
      oltMac: mac,
      indexStr,
      action: ACTION_ACTIVATE,
      customerId: meta.customerId,
      customerNumber: meta.customerNumber,
    });
    return { ok: true, skipped: false, oltMac: mac, indexStr };
  } catch (e) {
    return {
      ok: false,
      skipped: false,
      error: e.message || "OLT activate failed",
      oltMac: mac,
      indexStr,
    };
  }
}

async function deactivateOnuForCustomer(record, meta = {}) {
  if (!isOltEmsConfigured()) {
    return { ok: true, skipped: true, reason: "olt_not_configured" };
  }
  const { mac, indexStr } = resolveOltBinding(record);
  if (!mac || !indexStr) {
    return { ok: true, skipped: true, reason: "no_onu_mapping" };
  }
  try {
    await setOnuAdminStatus({
      oltMac: mac,
      indexStr,
      action: ACTION_DEACTIVATE,
      customerId: meta.customerId,
      customerNumber: meta.customerNumber,
    });
    return { ok: true, skipped: false, oltMac: mac, indexStr };
  } catch (e) {
    return {
      ok: false,
      skipped: false,
      error: e.message || "OLT deactivate failed",
      oltMac: mac,
      indexStr,
    };
  }
}

function shouldActivateOnPayment(subscriptionStatus) {
  const status = String(subscriptionStatus || "").trim().toLowerCase();
  return status === "suspended" || status === "paused";
}

module.exports = {
  isOltEmsConfigured,
  resolveOltBinding,
  buildIndexStrFromOnu,
  getOnuList,
  getOnuAbility,
  activateOnuForCustomer,
  deactivateOnuForCustomer,
  shouldActivateOnPayment,
  ACTION_ACTIVATE,
  ACTION_DEACTIVATE,
};
