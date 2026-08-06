const axios = require("axios");
const { logApiCall } = require("../utils/apiCallLogger");

const OLT_EMS_DEFAULT_PORT = 38881;
const OLT_EMS_TIMEOUT_MS = Number(process.env.OLT_EMS_TIMEOUT_MS || 30_000);

const ACTION_REBOOT = 1;
const ACTION_DELETE = 2;
const ACTION_ACTIVATE = 3;
const ACTION_DEACTIVATE = 4;

/** @type {Map<string, { token: string, expiresAt: number }>} */
const tokenByBase = new Map();

function isEmsSuccess(body) {
  return body && Number(body.code) === 200;
}

function normalizeHost(host) {
  return String(host || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");
}

function buildEmsBaseUrl(host, port) {
  const h = normalizeHost(host);
  if (!h) return "";
  if (/^https?:\/\//i.test(String(host || "").trim())) {
    return String(host).trim().replace(/\/$/, "");
  }
  const p = Number(port) > 0 ? Number(port) : OLT_EMS_DEFAULT_PORT;
  return `http://${h}:${p}`;
}

function pickField(record, keys) {
  for (const key of keys) {
    if (record[key] != null && String(record[key]).trim() !== "") {
      return record[key];
    }
  }
  return null;
}

/**
 * Resolve EMS connection from a pop_olts row or customer+OLT join row.
 */
function resolveEmsTarget(record = {}) {
  const buildingHost = pickField(record, [
    "building_olt_host",
    "buildingOltHost",
    "olt_host",
    "oltHost",
    "host",
  ]);
  const buildingPort =
    pickField(record, [
      "building_olt_port",
      "buildingOltPort",
      "olt_port",
      "oltPort",
      "port",
    ]) ?? OLT_EMS_DEFAULT_PORT;
  const baseUrl = buildEmsBaseUrl(buildingHost, buildingPort);

  const mac = String(
    pickField(record, [
      "olt_mac",
      "oltMac",
      "building_olt_mac",
      "buildingOltMac",
      "mac",
    ]) || ""
  )
    .trim()
    .toLowerCase();

  const username = String(
    pickField(record, [
      "building_olt_username",
      "buildingOltUsername",
      "olt_username",
      "oltUsername",
      "username",
    ]) || ""
  ).trim();
  const password = String(
    pickField(record, [
      "building_olt_password",
      "buildingOltPassword",
      "olt_password",
      "oltPassword",
      "password",
    ]) || ""
  );
  const tenantId = String(
    pickField(record, [
      "building_olt_tenant_id",
      "buildingOltTenantId",
      "olt_tenant_id",
      "oltTenantId",
      "tenant_id",
      "tenantId",
    ]) || "000000"
  ).trim();

  const indexStr = String(
    pickField(record, ["onu_index_str", "onuIndexStr"]) || ""
  ).trim();
  const sn = String(pickField(record, ["onu_sn", "onuSn"]) || "").trim();

  return {
    baseUrl,
    mac,
    indexStr,
    sn,
    username,
    password,
    tenantId,
    host: normalizeHost(buildingHost) || null,
    port: Number(buildingPort) > 0 ? Number(buildingPort) : OLT_EMS_DEFAULT_PORT,
  };
}

function isOltTargetConfigured(target) {
  return Boolean(
    target?.baseUrl && target?.mac && target?.username && target?.password
  );
}

/** @deprecated use isOltTargetConfigured(resolveEmsTarget(record)) */
function isOltEmsConfigured(record) {
  if (record && typeof record === "object") {
    return isOltTargetConfigured(resolveEmsTarget(record));
  }
  return false;
}

function resolveOltBinding(record = {}) {
  const t = resolveEmsTarget(record);
  return {
    mac: t.mac,
    indexStr: t.indexStr,
    sn: t.sn,
    baseUrl: t.baseUrl,
    username: t.username,
    password: t.password,
    tenantId: t.tenantId,
  };
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

function matchOnuForCustomer(onus, customer = {}) {
  const list = Array.isArray(onus) ? onus : [];
  const sn = String(customer.onu_sn || customer.onuSn || "")
    .trim()
    .toLowerCase();
  const indexStr = String(
    customer.onu_index_str || customer.onuIndexStr || ""
  ).trim();
  const customerNumber = String(
    customer.customer_number || customer.customerNumber || ""
  )
    .trim()
    .toUpperCase();
  const apartment = String(
    customer.apartment_number || customer.apartmentNumber || ""
  )
    .trim()
    .toUpperCase();

  if (sn) {
    const bySn = list.find(
      (o) => String(o.authInfo || "").trim().toLowerCase() === sn
    );
    if (bySn) return { onu: bySn, match: "sn" };
  }

  if (indexStr) {
    const byIndex = list.find((o) => buildIndexStrFromOnu(o) === indexStr);
    if (byIndex) return { onu: byIndex, match: "index" };
  }

  if (customerNumber) {
    const byNumber = list.find((o) =>
      String(o.description || "")
        .toUpperCase()
        .includes(customerNumber)
    );
    if (byNumber) return { onu: byNumber, match: "customer_number" };
  }

  if (apartment && apartment.length >= 2) {
    const byApt = list.find((o) => {
      const desc = String(o.description || "").toUpperCase();
      return (
        desc.includes(`--${apartment}`) ||
        desc.includes(`-${apartment}`) ||
        desc.endsWith(apartment) ||
        desc.includes(apartment)
      );
    });
    if (byApt) return { onu: byApt, match: "apartment" };
  }

  return { onu: null, match: null };
}

function tokenCacheKey(baseUrl, username) {
  return `${String(baseUrl || "").replace(/\/$/, "")}|${username || ""}`;
}

async function login(target, force = false) {
  const root = String(target.baseUrl || "").replace(/\/$/, "");
  if (!root) {
    throw new Error("OLT EMS host is not configured for this building");
  }
  if (!target.username || !target.password) {
    throw new Error("OLT EMS username/password are not set on this building");
  }

  const cacheKey = tokenCacheKey(root, target.username);
  const cached = tokenByBase.get(cacheKey);
  if (!force && cached?.token && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const url = `${root}/emsWebServer/login`;
  const payload = {
    username: target.username,
    password: target.password,
    tenantId: target.tenantId || "000000",
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
    requestPayload: {
      username: target.username,
      tenantId: target.tenantId || "000000",
    },
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

  tokenByBase.set(cacheKey, {
    token,
    expiresAt: Date.now() + 50 * 60 * 1000,
  });
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
  target,
  retryOnAuth = true,
}) {
  if (!target || !isOltTargetConfigured(target)) {
    throw new Error(
      "OLT EMS is not fully configured on this building (host, MAC, username, password)"
    );
  }

  const root = String(target.baseUrl || "").replace(/\/$/, "");
  const token = await login(target);
  const url = `${root}${path}`;
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
    tokenByBase.delete(tokenCacheKey(root, target.username));
    return emsRequest({
      method,
      path,
      params,
      data,
      operation,
      customerId,
      customerNumber,
      target,
      retryOnAuth: false,
    });
  }

  if (!ok) {
    throw new Error(response.data?.message || "OLT EMS request failed");
  }

  return response.data;
}

async function getOnuList({
  oltMac,
  portIndex = 1,
  indexStr = "0-0-1-1-0",
  target,
} = {}) {
  const body = await emsRequest({
    path: "/emsWebServer/onuAuthList/getOnuAuthListInfos",
    params: { oltMac: oltMac || target?.mac, portIndex, indexStr },
    operation: "get_onu_list",
    target,
  });
  return body.data || [];
}

async function getOnuAbility({
  oltMac,
  portIndex = 1,
  onuIndex = 1,
  slotIndex = 0,
  onuProfileName = "default",
  indexStr,
  target,
} = {}) {
  const body = await emsRequest({
    method: "POST",
    path: "/emsWebServer/gonuPriConfig/getPriOnuInfo",
    params: {
      oltMac: oltMac || target?.mac,
      portIndex,
      onuIndex,
      slotIndex,
      onuProfileName,
      indexStr,
    },
    operation: "get_onu_ability",
    target,
  });
  return body.data;
}

async function setOnuAdminStatus({
  oltMac,
  indexStr,
  action,
  customerId = null,
  customerNumber = null,
  target,
}) {
  const body = await emsRequest({
    path: "/emsWebServer/onuAuthList/setOperationOnu",
    params: {
      oltMac: oltMac || target?.mac,
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
    target,
  });
  return body;
}

function skipReason(target) {
  if (!target?.baseUrl) return "no_building_olt_host";
  if (!target?.mac) return "no_olt_mac";
  if (!target?.username || !target?.password) return "no_olt_credentials";
  if (!target?.indexStr) return "no_onu_mapping";
  return null;
}

async function activateOnuForCustomer(record, meta = {}) {
  const target = resolveEmsTarget(record);
  const reason = skipReason(target);
  if (reason) {
    return { ok: true, skipped: true, reason };
  }
  try {
    await setOnuAdminStatus({
      oltMac: target.mac,
      indexStr: target.indexStr,
      action: ACTION_ACTIVATE,
      customerId: meta.customerId,
      customerNumber: meta.customerNumber,
      target,
    });
    return {
      ok: true,
      skipped: false,
      oltMac: target.mac,
      indexStr: target.indexStr,
      baseUrl: target.baseUrl,
    };
  } catch (e) {
    return {
      ok: false,
      skipped: false,
      error: e.message || "OLT activate failed",
      oltMac: target.mac,
      indexStr: target.indexStr,
    };
  }
}

async function deactivateOnuForCustomer(record, meta = {}) {
  const target = resolveEmsTarget(record);
  const reason = skipReason(target);
  if (reason) {
    return { ok: true, skipped: true, reason };
  }
  try {
    await setOnuAdminStatus({
      oltMac: target.mac,
      indexStr: target.indexStr,
      action: ACTION_DEACTIVATE,
      customerId: meta.customerId,
      customerNumber: meta.customerNumber,
      target,
    });
    return {
      ok: true,
      skipped: false,
      oltMac: target.mac,
      indexStr: target.indexStr,
      baseUrl: target.baseUrl,
    };
  } catch (e) {
    return {
      ok: false,
      skipped: false,
      error: e.message || "OLT deactivate failed",
      oltMac: target.mac,
      indexStr: target.indexStr,
    };
  }
}

async function getCustomerOltStatus(record) {
  const target = resolveEmsTarget(record);
  const building = {
    host: target.host,
    port: target.port,
    mac: target.mac || null,
    username: target.username || null,
    configured: isOltTargetConfigured(target),
  };

  if (!building.configured) {
    return {
      ok: true,
      skipped: true,
      reason: skipReason({ ...target, indexStr: "skip" }) || "incomplete_olt_config",
      building,
      onu: null,
      match: null,
    };
  }

  try {
    const onus = await getOnuList({
      oltMac: target.mac,
      portIndex: 1,
      indexStr: "0-0-1-1-0",
      target,
    });
    const { onu, match } = matchOnuForCustomer(onus, record);
    return {
      ok: true,
      skipped: false,
      building,
      match,
      onu: onu
        ? {
            authOnu: onu.authOnu,
            authPon: onu.authPon,
            authSlot: onu.authSlot,
            adminStatus: onu.adminStatus,
            phaseStatus: onu.phaseStatus,
            authInfo: onu.authInfo,
            description: onu.description,
            onuModel: onu.onuModel,
            onuType: onu.onuType,
            onuRttDistance: onu.onuRttDistance,
            indexStr: buildIndexStrFromOnu(onu),
          }
        : null,
      onuCount: Array.isArray(onus) ? onus.length : 0,
    };
  } catch (e) {
    return {
      ok: false,
      skipped: false,
      error: e.message || "OLT status query failed",
      building,
      onu: null,
      match: null,
    };
  }
}

/**
 * When a customer is not linked to a specific OLT, scan all building OLTs
 * and return the first match (or the last result if none match).
 */
async function getCustomerOltStatusAcrossOlts(customerRecord, oltRows = []) {
  let last = null;
  for (const olt of oltRows) {
    const merged = {
      ...customerRecord,
      building_olt_host: olt.host,
      building_olt_port: olt.port,
      building_olt_mac: olt.mac,
      building_olt_username: olt.username,
      building_olt_password: olt.password,
      building_olt_tenant_id: olt.tenant_id,
      // Prefer customer-linked MAC when set; otherwise use this OLT's MAC
      olt_mac: customerRecord.olt_mac || olt.mac,
    };
    const status = await getCustomerOltStatus(merged);
    status.buildingOltId = olt.id;
    status.buildingOltName = olt.name || null;
    if (status.onu || status.match) {
      return status;
    }
    last = status;
  }
  return (
    last || {
      ok: true,
      skipped: true,
      reason: "no_building_olt_host",
      building: {
        host: null,
        port: null,
        mac: null,
        username: null,
        configured: false,
      },
      onu: null,
      match: null,
    }
  );
}

function shouldActivateOnPayment(subscriptionStatus) {
  const status = String(subscriptionStatus || "").trim().toLowerCase();
  return status === "suspended" || status === "paused";
}

module.exports = {
  isOltEmsConfigured,
  isOltTargetConfigured,
  resolveOltBinding,
  resolveEmsTarget,
  buildEmsBaseUrl,
  buildIndexStrFromOnu,
  matchOnuForCustomer,
  getOnuList,
  getOnuAbility,
  getCustomerOltStatus,
  getCustomerOltStatusAcrossOlts,
  activateOnuForCustomer,
  deactivateOnuForCustomer,
  shouldActivateOnPayment,
  ACTION_ACTIVATE,
  ACTION_DEACTIVATE,
};
