const axios = require("axios");

const DEFAULT_BASE_URL = "https://startlyx.iptvconsole.hydeinnovations.com";
const TOKEN_SKEW_MS = 60 * 1000;

class StartlyxError extends Error {
  constructor(message, { status = 502, code = null, data = null } = {}) {
    super(message);
    this.name = "StartlyxError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
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

function normalizeBaseUrl(raw) {
  const base = String(raw || "").trim();
  if (!base) return DEFAULT_BASE_URL;
  return base.replace(/\/+$/, "").replace(/\/doc\/api\/.*$/i, "");
}

let runtimeConfig = null;
let tokenCache = { token: null, expiresAt: 0 };

function envConfig() {
  return {
    baseUrl: normalizeBaseUrl(process.env.STARTLYX_BASE_URL || DEFAULT_BASE_URL),
    email: cleanEnvValue(process.env.STARTLYX_ADMIN_EMAIL),
    password: cleanEnvValue(process.env.STARTLYX_ADMIN_PASSWORD),
    timeoutMs: Number(process.env.STARTLYX_REQUEST_TIMEOUT_MS || 20000),
  };
}

function applySavedSettings(saved) {
  const env = envConfig();
  runtimeConfig = {
    baseUrl: normalizeBaseUrl(saved?.baseUrl || env.baseUrl),
    email: cleanEnvValue(saved?.adminEmail || saved?.email || env.email),
    password: cleanEnvValue(
      saved?.adminPassword || saved?.password || env.password
    ),
    timeoutMs: Number(saved?.timeoutMs || env.timeoutMs || 20000),
  };
  tokenCache = { token: null, expiresAt: 0 };
  return runtimeConfig;
}

function getConfig() {
  return runtimeConfig || envConfig();
}

async function loadConfig() {
  if (runtimeConfig) return runtimeConfig;
  try {
    const { getStartlyxSettings } = require("../appSettingsStore");
    return applySavedSettings(await getStartlyxSettings());
  } catch {
    return applySavedSettings(null);
  }
}

function isConfigured() {
  const { email, password } = getConfig();
  return Boolean(email && password);
}

function publicStatus() {
  const { baseUrl, email } = getConfig();
  return {
    configured: isConfigured(),
    baseUrl,
    adminEmail: email ? maskEmail(email) : null,
  };
}

function maskEmail(email) {
  const s = String(email || "");
  const at = s.indexOf("@");
  if (at <= 1) return "***";
  return `${s[0]}***${s.slice(at)}`;
}

function unwrapList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.channels)) return data.channels;
  if (Array.isArray(data.packages)) return data.packages;
  if (Array.isArray(data.users)) return data.users;
  if (Array.isArray(data.subscriptions)) return data.subscriptions;
  if (Array.isArray(data.categories)) return data.categories;
  return [];
}

/** Live Startlyx responses often wrap the payload as `{ status: "success", data }`. */
function unwrapSuccess(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  if (
    (data.status === "success" || data.status === "ok") &&
    Object.prototype.hasOwnProperty.call(data, "data")
  ) {
    return data.data;
  }
  return data;
}

function extractAccessToken(data) {
  const payload = unwrapSuccess(data);
  const nested =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload
      : {};
  return (
    nested.access_token ||
    nested.accessToken ||
    nested.token ||
    null
  );
}

function extractErrorMessage(data, fallback) {
  if (!data) return fallback;
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed) return fallback;
    if (trimmed.startsWith("<")) return fallback;
    return trimmed.slice(0, 400);
  }
  if (typeof data === "object") {
    const msg = data.message || data.error || data.detail || data.code;
    if (msg && typeof msg === "object") {
      return extractErrorMessage(msg, fallback);
    }
    if (msg) return String(msg);
  }
  return fallback;
}

function decodeJwtExpiryMs(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    );
    if (!payload?.exp) return null;
    return Number(payload.exp) * 1000;
  } catch {
    return null;
  }
}

function resetAuthCache() {
  tokenCache = { token: null, expiresAt: 0 };
  runtimeConfig = null;
}

function cachedToken() {
  if (!tokenCache.token) return null;
  if (tokenCache.expiresAt && Date.now() >= tokenCache.expiresAt - TOKEN_SKEW_MS) {
    return null;
  }
  return tokenCache.token;
}

function storeToken(token) {
  const value = String(token || "").trim();
  if (!value) return;
  tokenCache = {
    token: value,
    expiresAt: decodeJwtExpiryMs(value) || Date.now() + 15 * 60 * 1000,
  };
}

function buildCreateUserPayload(input = {}) {
  const email = String(input.email || "").trim().toLowerCase();
  const username = String(input.username || "").trim();
  const payload = { email, username };
  const phone = String(input.phone_number || input.phoneNumber || "").trim();
  if (phone) payload.phone_number = phone;
  const address = String(input.address || "").trim();
  if (address) payload.address = address;
  return payload;
}

function buildUpdateUserPayload(input = {}) {
  const payload = {};
  if (input.email != null) {
    const email = String(input.email).trim().toLowerCase();
    if (email) payload.email = email;
  }
  if (input.username != null) {
    const username = String(input.username).trim();
    if (username) payload.username = username;
  }
  if (input.phone_number != null || input.phoneNumber != null) {
    payload.phone_number = String(input.phone_number || input.phoneNumber || "").trim();
  }
  if (input.address != null) {
    payload.address = String(input.address).trim();
  }
  return payload;
}

function buildSubscribePayload(input = {}) {
  const userId = String(input.user_id || input.userId || "").trim();
  const packageId = String(input.package_id || input.packageId || "").trim();
  const payload = { user_id: userId, package_id: packageId };
  const duration = Number(input.duration_months || input.durationMonths);
  if (Number.isFinite(duration) && duration > 0) {
    payload.duration_months = Math.floor(duration);
  }
  return payload;
}

function mapUser(row) {
  if (!row || typeof row !== "object") return null;
  const status = String(row.status || "").trim().toLowerCase() || null;
  return {
    id: row.id || null,
    email: row.email || null,
    username: row.username || null,
    phoneNumber: row.phone_number || row.phoneNumber || null,
    address: row.address || null,
    onboardedBy: row.onboarded_by || row.onboardedBy || null,
    starlynxUserId: row.starlynx_user_id || row.starlynxUserId || null,
    status,
  };
}

function mapPackage(row) {
  if (!row || typeof row !== "object") return null;
  return {
    id: row.id || null,
    name: row.package_name || row.packageName || row.name || null,
    rank: row.rank ?? null,
    price: row.price ?? null,
    currency: row.currency || "KES",
    sessions: row.number_of_allowed_sessions ?? row.numberOfAllowedSessions ?? null,
    channelCount: row.number_of_channels ?? row.numberOfChannels ?? null,
    features: Array.isArray(row.features) ? row.features : [],
    active: row.active !== false,
  };
}

function mapChannel(row, categoryName = null) {
  if (!row || typeof row !== "object") return null;
  const state = row.state && typeof row.state === "object" ? row.state : {};
  const status = String(state.status || (row.enabled === false ? "disabled" : "unknown"));
  return {
    id: row.id || null,
    name: row.name || "Untitled channel",
    channelNumber: row.channel_number || row.channelNumber || null,
    categoryId: row.category_id || row.categoryId || null,
    categoryName: categoryName || null,
    enabled: row.enabled !== false,
    drmEnabled: Boolean(row.drm_enabled || row.drmEnabled),
    status,
    alive: state.alive == null ? null : Boolean(state.alive),
    bitrate: state.bitrate ?? null,
    clientCount: state.client_count ?? state.clientCount ?? null,
    lastError: state.last_error || state.lastError || null,
    uptimeMs: state.uptime_ms ?? state.uptimeMs ?? null,
  };
}

function mapSubscription(row) {
  if (!row || typeof row !== "object") return null;
  return {
    id: row.id || null,
    userId: row.user_id || row.userId || null,
    username: row.username || null,
    packageId: row.package_id || row.packageId || null,
    packageName: row.package_name || row.packageName || null,
    status: row.status || null,
    startDate: row.start_date || row.startDate || null,
    endDate: row.end_date || row.endDate || null,
  };
}

function isActiveSubscription(sub) {
  return String(sub?.status || "").trim().toLowerCase() === "active";
}

function accessStatusFromSubscriptions(subscriptions) {
  const list = Array.isArray(subscriptions) ? subscriptions : [];
  if (!list.length) return "no_subscription";
  if (list.some(isActiveSubscription)) return "active";
  const latest = [...list].sort((a, b) =>
    String(b.startDate || "").localeCompare(String(a.startDate || ""))
  )[0];
  const status = String(latest?.status || "").trim().toLowerCase();
  return status === "cancelled" ? "disconnected" : status || "disconnected";
}

function pickReconnectPackage(subscriptions, preferredPackageId) {
  const preferred = String(preferredPackageId || "").trim();
  if (preferred) return preferred;
  const list = Array.isArray(subscriptions) ? subscriptions : [];
  const cancelled = list.find(
    (s) => String(s.status || "").toLowerCase() === "cancelled"
  );
  const expired = list.find(
    (s) => String(s.status || "").toLowerCase() === "expired"
  );
  return (cancelled || expired || list[0])?.packageId || null;
}

function mapCategory(row) {
  if (!row || typeof row !== "object") return null;
  return {
    id: row.id || null,
    name: row.name || row.category_name || row.categoryName || null,
  };
}

async function startlyxRequest(method, path, { body, auth = true, retry = true } = {}) {
  await loadConfig();
  const { baseUrl, timeoutMs } = getConfig();
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (auth) {
    const token = await getAccessToken();
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await axios.request({
      method,
      url: `${baseUrl}${path}`,
      data: body,
      headers,
      timeout: timeoutMs,
      validateStatus: () => true,
    });
  } catch (err) {
    throw new StartlyxError(
      err.code === "ECONNABORTED"
        ? "Startlyx request timed out"
        : err.message || "Startlyx is unreachable",
      { status: 502 }
    );
  }

  if (auth && retry && response.status === 401) {
    tokenCache = { token: null, expiresAt: 0 };
    return startlyxRequest(method, path, { body, auth, retry: false });
  }

  const data = unwrapSuccess(response.data);
  if (response.status >= 200 && response.status < 300) {
    return data;
  }

  throw new StartlyxError(
    extractErrorMessage(data, `Startlyx returned HTTP ${response.status}`),
    {
      status: response.status,
      code: data && typeof data === "object" ? data.code || null : null,
      data,
    }
  );
}

async function login() {
  await loadConfig();
  if (!isConfigured()) {
    throw new StartlyxError(
      "Startlyx is not configured. Save the console URL, admin email, and password in IPTV settings.",
      { status: 503 }
    );
  }
  const { email, password } = getConfig();
  const data = await startlyxRequest(
    "POST",
    "/api/v1/auth/admin/login",
    {
      body: { email, password },
      auth: false,
      retry: false,
    }
  );
  const token = extractAccessToken(data);
  if (!token) {
    throw new StartlyxError("Startlyx login did not return an access token", {
      status: 502,
      data,
    });
  }
  storeToken(token);
  return token;
}

async function getAccessToken() {
  const existing = cachedToken();
  if (existing) return existing;
  return login();
}

async function pingAuth() {
  await loadConfig();
  if (!isConfigured()) {
    return { ...publicStatus(), authenticated: false, error: "Not configured" };
  }
  try {
    await getAccessToken();
    return { ...publicStatus(), authenticated: true, error: null };
  } catch (err) {
    return {
      ...publicStatus(),
      authenticated: false,
      error: err.message || "Startlyx login failed",
    };
  }
}

async function listPackages() {
  await loadConfig();
  const configured = isConfigured();
  const data = await startlyxRequest("GET", "/api/v1/packages", {
    auth: configured,
    retry: configured,
  });
  return unwrapList(data).map(mapPackage).filter(Boolean);
}

async function listCategories() {
  await loadConfig();
  const configured = isConfigured();
  const data = await startlyxRequest("GET", "/api/v1/channel-categories", {
    auth: configured,
    retry: configured,
  });
  return unwrapList(data).map(mapCategory).filter(Boolean);
}

async function listChannels() {
  await loadConfig();
  const configured = isConfigured();
  const [raw, categories] = await Promise.all([
    startlyxRequest("GET", "/api/v1/channels", {
      auth: configured,
      retry: configured,
    }),
    listCategories().catch(() => []),
  ]);
  const byId = new Map(
    categories.filter((c) => c.id).map((c) => [String(c.id), c.name])
  );
  const items = unwrapList(raw);
  const total =
    raw && typeof raw === "object" && Number.isFinite(Number(raw.total))
      ? Number(raw.total)
      : items.length;
  return {
    total,
    items: items
      .map((row) =>
        mapChannel(row, byId.get(String(row.category_id || row.categoryId || "")) || null)
      )
      .filter(Boolean),
  };
}

async function listUsers() {
  const data = await startlyxRequest("GET", "/api/v1/users", { auth: true });
  return unwrapList(data).map(mapUser).filter(Boolean);
}

async function listUsersWithAccess() {
  const users = await listUsers();
  const out = new Array(users.length);
  let next = 0;
  async function worker() {
    while (next < users.length) {
      const i = next++;
      const user = users[i];
      try {
        const subs = user.id ? await listUserSubscriptions(user.id) : [];
        const latest = [...subs].sort((a, b) =>
          String(b.startDate || "").localeCompare(String(a.startDate || ""))
        )[0];
        out[i] = {
          ...user,
          status: accessStatusFromSubscriptions(subs),
          lastPackageId: latest?.packageId || null,
          lastPackageName: latest?.packageName || null,
        };
      } catch {
        out[i] = { ...user, status: null };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, users.length) }, worker));
  return out;
}

async function listUserSubscriptions(userId) {
  const id = encodeURIComponent(String(userId || "").trim());
  const data = await startlyxRequest(
    "GET",
    `/api/v1/subscriptions/user/${id}`,
    { auth: true }
  );
  return unwrapList(data).map(mapSubscription).filter(Boolean);
}

async function createUser(input) {
  const payload = buildCreateUserPayload(input);
  if (!payload.email || !payload.username) {
    throw new StartlyxError("email and username are required", { status: 400 });
  }
  const data = await startlyxRequest("POST", "/api/v1/users", {
    body: payload,
    auth: true,
  });
  return mapUser(data);
}

async function getUser(userId) {
  const id = String(userId || "").trim();
  if (!id) throw new StartlyxError("user_id is required", { status: 400 });
  const data = await startlyxRequest(
    "GET",
    `/api/v1/users/${encodeURIComponent(id)}`,
    { auth: true }
  );
  const user = mapUser(data);
  if (!user?.id) {
    throw new StartlyxError("Startlyx user not found", { status: 404 });
  }
  return user;
}

async function updateUser(userId, input = {}) {
  const id = String(userId || "").trim();
  if (!id) throw new StartlyxError("user_id is required", { status: 400 });
  const payload = buildUpdateUserPayload(input);
  if (!Object.keys(payload).length) {
    throw new StartlyxError("No user fields to update", { status: 400 });
  }
  const data = await startlyxRequest(
    "PATCH",
    `/api/v1/users/${encodeURIComponent(id)}`,
    { body: payload, auth: true }
  );
  return mapUser(data) || { id };
}

async function adminSubscribe(input) {
  const payload = buildSubscribePayload(input);
  if (!payload.user_id || !payload.package_id) {
    throw new StartlyxError("user_id and package_id are required", {
      status: 400,
    });
  }
  const data = await startlyxRequest("POST", "/api/v1/subscriptions/admin", {
    body: payload,
    auth: true,
  });
  return mapSubscription(data);
}

function matchUser(users, { email, username }) {
  const emailKey = String(email || "").trim().toLowerCase();
  const userKey = String(username || "").trim().toLowerCase();
  if (emailKey) {
    const byEmail = users.find(
      (u) => String(u.email || "").trim().toLowerCase() === emailKey
    );
    if (byEmail) return byEmail;
  }
  if (userKey) {
    return users.find(
      (u) => String(u.username || "").trim().toLowerCase() === userKey
    ) || null;
  }
  return null;
}

async function findUser({ email, username }) {
  const users = await listUsers();
  return matchUser(users, { email, username });
}

async function simulateCustomer(input = {}) {
  const payload = buildCreateUserPayload(input);
  const packageId = String(input.package_id || input.packageId || "").trim();
  if (!packageId) {
    throw new StartlyxError("package_id is required", { status: 400 });
  }

  let user = null;
  let userCreated = false;
  try {
    user = await createUser(payload);
    userCreated = true;
  } catch (err) {
    if (err instanceof StartlyxError && err.status === 409) {
      user = await findUser(payload);
      if (!user) {
        throw new StartlyxError(
          "User already exists on Startlyx but could not be looked up by email or username",
          { status: 409 }
        );
      }
    } else {
      throw err;
    }
  }

  const subscribeInput = {
    user_id: user.id,
    package_id: packageId,
    duration_months: input.duration_months || input.durationMonths,
  };

  let subscription = null;
  let subscriptionCreated = false;
  try {
    subscription = await adminSubscribe(subscribeInput);
    subscriptionCreated = true;
  } catch (err) {
    if (err instanceof StartlyxError && err.status === 409) {
      const existing = await listUserSubscriptions(user.id);
      subscription =
        existing.find(
          (s) =>
            String(s.packageId) === packageId &&
            String(s.status || "").toLowerCase() === "active"
        ) ||
        existing[0] ||
        null;
      if (!subscription) throw err;
    } else {
      throw err;
    }
  }

  return {
    user,
    subscription,
    userCreated,
    subscriptionCreated,
    reusedExistingUser: !userCreated,
  };
}

async function cancelSubscription(subscriptionId) {
  const id = String(subscriptionId || "").trim();
  if (!id) {
    throw new StartlyxError("subscription_id is required", { status: 400 });
  }
  const data = await startlyxRequest(
    "PATCH",
    `/api/v1/subscriptions/${encodeURIComponent(id)}`,
    { auth: true }
  );
  return mapSubscription(data) || { id, status: "cancelled" };
}

async function listUserSessions(userId) {
  const id = encodeURIComponent(String(userId || "").trim());
  const data = await startlyxRequest("GET", `/api/v1/sessions/user/${id}`, {
    auth: true,
  });
  return unwrapList(data).filter((row) => row && row.id);
}

async function endSession(sessionId) {
  const id = encodeURIComponent(String(sessionId || "").trim());
  return startlyxRequest("POST", `/api/v1/sessions/${id}/end`, { auth: true });
}

// Startlyx has no user suspend API (UpdateUserRequest ignores `status`), so
// access is removed by cancelling the entitlement and ending live sessions.
async function disconnectUser(userId) {
  const id = String(userId || "").trim();
  if (!id) throw new StartlyxError("user_id is required", { status: 400 });
  const user = await getUser(id);
  const before = await listUserSubscriptions(id);
  const active = before.filter(isActiveSubscription);
  const cancelled = [];
  for (const sub of active) {
    cancelled.push(await cancelSubscription(sub.id));
  }

  let sessionsEnded = 0;
  const sessions = await listUserSessions(id).catch(() => []);
  for (const session of sessions) {
    if (session.ended_at || session.endedAt) continue;
    try {
      await endSession(session.id);
      sessionsEnded += 1;
    } catch {
      /* session may already be closed */
    }
  }

  const subscriptions = await listUserSubscriptions(id).catch(() => before);
  const stillActive = subscriptions.find(isActiveSubscription) || null;
  if (stillActive) {
    throw new StartlyxError(
      "Startlyx still reports an active subscription after cancel",
      { status: 502 }
    );
  }
  return {
    userId: id,
    disconnected: true,
    alreadyDisconnected: active.length === 0,
    cancelledSubscriptions: cancelled.length,
    sessionsEnded,
    userStatus: "disconnected",
    user,
    subscription: cancelled[0] || subscriptions[0] || null,
    subscriptions,
  };
}

async function reconnectUser(userId, input = {}) {
  const id = String(userId || "").trim();
  if (!id) throw new StartlyxError("user_id is required", { status: 400 });
  const user = await getUser(id);
  let subscriptions = await listUserSubscriptions(id);
  let subscription = subscriptions.find(isActiveSubscription) || null;
  let subscriptionCreated = false;
  // Restore entitlement on the same Startlyx user — never POST /users again.
  if (!subscription) {
    const packageId = pickReconnectPackage(
      subscriptions,
      input.package_id || input.packageId
    );
    if (!packageId) {
      throw new StartlyxError("package_id is required to reconnect this user", {
        status: 400,
      });
    }
    subscription = await adminSubscribe({
      user_id: id,
      package_id: packageId,
      duration_months: input.duration_months || input.durationMonths,
    });
    subscriptionCreated = true;
    if (subscription) subscriptions = [subscription, ...subscriptions];
  }
  return {
    userId: id,
    reconnected: true,
    alreadyActive: !subscriptionCreated,
    userStatus: subscription && isActiveSubscription(subscription) ? "active" : "unknown",
    user,
    subscription,
    subscriptions,
  };
}

function clientStatusFromError(err) {
  if (!(err instanceof StartlyxError)) return 500;
  if (err.status === 400 || err.status === 404 || err.status === 409 || err.status === 503) {
    return err.status;
  }
  return 502;
}

module.exports = {
  StartlyxError,
  DEFAULT_BASE_URL,
  normalizeBaseUrl,
  cleanEnvValue,
  unwrapList,
  unwrapSuccess,
  extractAccessToken,
  extractErrorMessage,
  decodeJwtExpiryMs,
  buildCreateUserPayload,
  buildUpdateUserPayload,
  buildSubscribePayload,
  mapUser,
  mapPackage,
  mapChannel,
  mapSubscription,
  matchUser,
  isConfigured,
  publicStatus,
  resetAuthCache,
  getConfig,
  loadConfig,
  applySavedSettings,
  pingAuth,
  listPackages,
  listChannels,
  listUsers,
  listUsersWithAccess,
  accessStatusFromSubscriptions,
  listUserSubscriptions,
  getUser,
  updateUser,
  createUser,
  adminSubscribe,
  simulateCustomer,
  isActiveSubscription,
  pickReconnectPackage,
  cancelSubscription,
  disconnectUser,
  reconnectUser,
  clientStatusFromError,
};
