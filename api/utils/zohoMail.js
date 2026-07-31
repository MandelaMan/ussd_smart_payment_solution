const axios = require("axios");
const { logApiCall } = require("./apiCallLogger");

const ZOHO_AUTH_URL = process.env.ZOHO_AUTH_URL || "https://accounts.zoho.com/oauth/v2/token";
const ZOHO_MAIL_REFRESH_TOKEN =
  process.env.ZOHO_MAIL_REFRESH_TOKEN || process.env.ZOHO_REFRESH_TOKEN;
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_MAIL_API_BASE = process.env.ZOHO_MAIL_API_BASE || "https://mail.zoho.com/api";

let cachedToken = null;
let tokenExpiresAt = 0;
let refreshingPromise = null;
let resolvedAccountId = null;
let resolvingAccountPromise = null;

async function loadMailIdentity() {
  try {
    const appSettingsStore = require("../services/appSettingsStore");
    return await appSettingsStore.getCommunicationEmailSettings();
  } catch {
    return {
      fromAddress:
        process.env.ZOHO_MAIL_FROM_ADDRESS || "customersupport@sulsolutions.biz",
      fromName: process.env.ZOHO_MAIL_FROM_NAME || "Customer Support",
      accountId: process.env.ZOHO_MAIL_ACCOUNT_ID || null,
    };
  }
}

function clearMailAccountCache() {
  resolvedAccountId = null;
  resolvingAccountPromise = null;
}

async function refreshAccessToken() {
  if (!ZOHO_MAIL_REFRESH_TOKEN || !ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET) {
    throw new Error(
      "Zoho Mail OAuth not configured — set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_MAIL_REFRESH_TOKEN with ZohoMail.messages scopes"
    );
  }

  const { data } = await axios.post(ZOHO_AUTH_URL, null, {
    params: {
      refresh_token: ZOHO_MAIL_REFRESH_TOKEN,
      client_id: ZOHO_CLIENT_ID,
      client_secret: ZOHO_CLIENT_SECRET,
      grant_type: "refresh_token",
    },
    timeout: 10000,
  });

  const ttlSec = Number(data.expires_in || 3600);
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + Math.max(30_000, (ttlSec - 300) * 1000);
  return cachedToken;
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) return cachedToken;
  if (!refreshingPromise) {
    refreshingPromise = refreshAccessToken().finally(() => {
      refreshingPromise = null;
    });
  }
  return refreshingPromise;
}

function isZohoMailConfigured() {
  return Boolean(ZOHO_MAIL_REFRESH_TOKEN && ZOHO_CLIENT_ID && ZOHO_CLIENT_SECRET);
}

async function getZohoMailConfig() {
  const identity = await loadMailIdentity();
  return {
    configured: isZohoMailConfigured(),
    fromAddress: identity.fromAddress || null,
    fromName: identity.fromName,
    accountId: identity.accountId
      ? /^\d+$/.test(String(identity.accountId))
        ? String(identity.accountId)
        : identity.accountId
      : null,
    oauthTokenConfigured: Boolean(ZOHO_MAIL_REFRESH_TOKEN),
  };
}

function accountEmails(account) {
  const emails = new Set();
  const push = (v) => {
    const s = String(v || "")
      .trim()
      .toLowerCase();
    if (s.includes("@")) emails.add(s);
  };
  push(account?.mailboxAddress);
  push(account?.emailAddress);
  push(account?.primaryEmailAddress);
  push(account?.accountName);
  for (const detail of account?.sendMailDetails || []) {
    push(detail?.fromAddress);
    push(detail?.displayName);
  }
  return emails;
}

/**
 * Zoho Mail APIs need a numeric accountId. Settings/env may hold email —
 * resolve via GET /accounts when needed.
 */
async function getMailAccountId() {
  if (resolvedAccountId) return resolvedAccountId;

  const identity = await loadMailIdentity();
  const configuredId = identity.accountId;
  if (/^\d+$/.test(String(configuredId || ""))) {
    resolvedAccountId = String(configuredId);
    return resolvedAccountId;
  }

  if (!resolvingAccountPromise) {
    resolvingAccountPromise = (async () => {
      const token = await getAccessToken();
      const url = `${ZOHO_MAIL_API_BASE}/accounts`;
      const response = await axios.get(url, {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          Accept: "application/json",
        },
        timeout: 15000,
        validateStatus: () => true,
      });

      const errorCode = response.data?.data?.errorCode || response.data?.errorCode;
      if (response.status >= 400 || errorCode) {
        if (String(errorCode).includes("INVALID_OAUTH") || response.status === 401) {
          throw new Error(
            "Zoho Mail OAuth scope missing — set ZOHO_MAIL_REFRESH_TOKEN with ZohoMail.messages.ALL,ZohoMail.accounts.READ"
          );
        }
        throw new Error(
          `Zoho Mail accounts lookup failed (${response.status}): ${
            response.data?.status?.description || errorCode || "unknown error"
          }`
        );
      }

      const accounts = Array.isArray(response.data?.data)
        ? response.data.data
        : [];
      const target = String(identity.fromAddress || configuredId || "")
        .trim()
        .toLowerCase();

      const match =
        accounts.find((a) => accountEmails(a).has(target)) ||
        accounts.find((a) =>
          [...accountEmails(a)].some(
            (e) =>
              e.includes("customersupport@sulsolutions.biz") ||
              e.includes("director@sulsolutions.biz")
          )
        ) ||
        accounts[0];

      const id = match?.accountId ?? match?.account_id;
      if (!id) {
        throw new Error(
          "Could not resolve Zoho Mail account ID — set it under Settings → Communication"
        );
      }
      resolvedAccountId = String(id);
      return resolvedAccountId;
    })().finally(() => {
      resolvingAccountPromise = null;
    });
  }
  return resolvingAccountPromise;
}

async function mailRequest(method, path, options = {}) {
  const token = await getAccessToken();
  const accountId = await getMailAccountId();
  const url = `${ZOHO_MAIL_API_BASE}/accounts/${accountId}${path}`;
  const response = await axios({
    method,
    url,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      Accept: "application/json",
      ...(options.headers || {}),
    },
    timeout: options.timeout || 30000,
    validateStatus: () => true,
    ...options,
    url,
  });
  return { ...response, url, accountId };
}

/**
 * Upload a file to Zoho Mail file store before attaching to a message.
 * @see https://www.zoho.com/mail/help/api/post-upload-attachments.html
 */
async function uploadZohoAttachment({ fileName, buffer, contentType }) {
  const name = String(fileName || "attachment").slice(0, 200);
  const response = await mailRequest("POST", "/messages/attachments", {
    params: { fileName: name },
    data: buffer,
    headers: {
      "Content-Type": contentType || "application/octet-stream",
    },
    maxBodyLength: 15 * 1024 * 1024,
    maxContentLength: 15 * 1024 * 1024,
    timeout: 60000,
  });

  const data = response.data;
  const code = data?.status?.code ?? data?.code;
  const success = !code || Number(code) === 200;
  if (!success) {
    const msg = data?.status?.description || data?.message || JSON.stringify(data);
    throw new Error(`Zoho Mail attachment upload failed: ${msg}`);
  }

  const payload = data?.data || data;
  return {
    storeName: payload.storeName,
    attachmentPath: payload.attachmentPath,
    attachmentName: payload.attachmentName || name,
  };
}

/**
 * Send email via Zoho Mail API (optional attachments).
 * @see https://www.zoho.com/mail/help/api/post-send-an-email.html
 * @see https://www.zoho.com/mail/help/api/post-send-email-attachment.html
 */
async function sendZohoMail({
  toAddress,
  subject,
  content,
  ccAddress,
  bccAddress,
  mailFormat = "html",
  attachments = [],
}) {
  if (!isZohoMailConfigured()) {
    throw new Error(
      "Zoho Mail is not configured — set ZOHO_MAIL_REFRESH_TOKEN in .env (OAuth). From address is managed in Settings → Communication."
    );
  }

  const identity = await loadMailIdentity();
  const to = String(toAddress || "").trim();
  if (!to || !to.includes("@")) {
    throw new Error("Valid recipient email is required");
  }

  const uploaded = [];
  for (const file of attachments || []) {
    if (!file?.buffer || !file?.fileName) continue;
    uploaded.push(
      await uploadZohoAttachment({
        fileName: file.fileName,
        buffer: file.buffer,
        contentType: file.contentType,
      })
    );
  }

  const accountId = await getMailAccountId();
  const token = await getAccessToken();
  const url = `${ZOHO_MAIL_API_BASE}/accounts/${accountId}/messages`;

  const payload = {
    fromAddress: identity.fromAddress,
    toAddress: to,
    subject: String(subject || "").trim(),
    content,
    mailFormat,
  };
  if (ccAddress) payload.ccAddress = ccAddress;
  if (bccAddress) payload.bccAddress = bccAddress;
  if (uploaded.length) payload.attachments = uploaded;

  let data;
  let httpStatus = null;
  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      timeout: 30000,
      validateStatus: () => true,
    });
    data = response.data;
    httpStatus = response.status;
  } catch (error) {
    await logApiCall({
      service: "zoho",
      operation: "send_mail",
      method: "POST",
      endpoint: url,
      status: "failure",
      httpStatus: error.response?.status ?? null,
      requestPayload: {
        toAddress: to,
        subject: payload.subject,
        mailFormat,
        hasCc: Boolean(ccAddress),
        attachmentCount: uploaded.length,
      },
      responsePayload: error.response?.data ?? null,
      errorMessage: error.message,
      retryable: true,
    }).catch(() => {});
    throw error;
  }

  const code = data?.status?.code ?? data?.code;
  const success = !code || Number(code) === 200;

  await logApiCall({
    service: "zoho",
    operation: "send_mail",
    method: "POST",
    endpoint: url,
    status: success ? "success" : "failure",
    httpStatus,
    requestPayload: {
      toAddress: to,
      subject: payload.subject,
      mailFormat,
      hasCc: Boolean(ccAddress),
      attachmentCount: uploaded.length,
    },
    responsePayload: data,
    errorMessage: success
      ? null
      : data?.status?.description || data?.message || `Zoho Mail API error (${code})`,
    referenceId: data?.data?.messageId || data?.data?.mailId || null,
    retryable: !success,
  }).catch(() => {});

  if (!success) {
    const msg = data?.status?.description || data?.message || JSON.stringify(data);
    throw new Error(`Zoho Mail API error: ${msg}`);
  }

  return {
    ok: true,
    messageId: data?.data?.messageId || data?.data?.mailId || null,
    toAddress: to,
    subject: payload.subject,
    fromAddress: identity.fromAddress,
    fromName: identity.fromName,
    attachmentNames: uploaded.map((a) => a.attachmentName),
  };
}

/**
 * Search mailbox for messages involving an address (sent or received).
 * Requires ZohoMail.messages.READ (or ALL). Failures return [].
 * Hydrates each hit with full HTML body (search only returns a short summary).
 */
async function searchZohoMailConversation(email, { limit = 40 } = {}) {
  const address = String(email || "")
    .trim()
    .toLowerCase();
  if (!address.includes("@") || !isZohoMailConfigured()) return [];

  try {
    const identity = await loadMailIdentity();
    const searchKey = `sender:${address}::or:to:${address}`;
    const response = await mailRequest("GET", "/messages/search", {
      params: {
        searchKey,
        start: 1,
        limit: Math.min(100, Math.max(1, limit)),
        includeto: true,
      },
      timeout: 20000,
    });

    const code = response.data?.status?.code ?? response.data?.code;
    if (code && Number(code) !== 200) return [];

    const rows = Array.isArray(response.data?.data) ? response.data.data : [];
    const fromMailbox = String(identity.fromAddress || "").toLowerCase();

    const mapped = rows.map((row) => {
      const from = String(row.fromAddress || "").toLowerCase();
      const inbound = from === address || (from && from !== fromMailbox);
      const messageId = row.messageId ?? row.messageid;
      const folderId = row.folderId ?? row.folderid;
      return {
        id: `zoho-${messageId}`,
        source: "zoho",
        direction: inbound ? "inbound" : "outbound",
        fromAddress: row.fromAddress || null,
        toAddress: Array.isArray(row.toAddress)
          ? row.toAddress.join(", ")
          : row.toAddress || null,
        subject: row.subject || "(no subject)",
        summary: row.summary || "",
        bodyHtml: null,
        bodyText: row.summary || "",
        attachmentNames: Number(row.hasAttachment) > 0 ? ["(attachment)"] : [],
        zohoMessageId: messageId != null ? String(messageId) : null,
        zohoFolderId: folderId != null ? String(folderId) : null,
        createdAt: row.receivedtime
          ? new Date(Number(row.receivedtime)).toISOString()
          : row.sentDateInGMT
            ? new Date(Number(row.sentDateInGMT)).toISOString()
            : null,
      };
    });

    return hydrateZohoMessageBodies(mapped);
  } catch {
    return [];
  }
}

/**
 * Fetch full HTML for a single Zoho message.
 * includeBlockContent=true keeps quoted reply history that Zoho otherwise omits.
 */
async function fetchZohoMailContent(folderId, messageId) {
  if (!folderId || !messageId) return null;
  try {
    const response = await mailRequest(
      "GET",
      `/folders/${folderId}/messages/${messageId}/content`,
      {
        params: { includeBlockContent: true },
        timeout: 20000,
      }
    );
    const code = response.data?.status?.code ?? response.data?.code;
    if (code && Number(code) !== 200) return null;
    const content = response.data?.data?.content;
    return content != null ? String(content) : null;
  } catch {
    return null;
  }
}

function stripTagsForPreview(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function mapPool(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await mapper(items[i], i);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

async function hydrateZohoMessageBodies(messages) {
  if (!messages.length) return messages;
  const { getCache, setCache } = require("../lib/cache");

  return mapPool(messages, 4, async (msg) => {
    if (!msg.zohoMessageId || !msg.zohoFolderId) return msg;

    const cacheKey = `${msg.zohoFolderId}:${msg.zohoMessageId}`;
    try {
      const cached = await getCache("zoho-mail-body", cacheKey);
      if (cached?.bodyHtml) {
        return {
          ...msg,
          bodyHtml: cached.bodyHtml,
          bodyText: cached.bodyText || msg.bodyText || msg.summary || "",
          summary: msg.summary || cached.summary || "",
        };
      }
    } catch {
      /* cache miss / redis down — fetch live */
    }

    const html = await fetchZohoMailContent(msg.zohoFolderId, msg.zohoMessageId);
    if (!html) return msg;
    const text = stripTagsForPreview(html);
    const next = {
      ...msg,
      bodyHtml: html,
      bodyText: text || msg.bodyText || msg.summary || "",
      summary: msg.summary || text.slice(0, 240),
    };

    void setCache(
      "zoho-mail-body",
      cacheKey,
      {
        bodyHtml: next.bodyHtml,
        bodyText: next.bodyText,
        summary: next.summary,
      },
      1800
    ).catch(() => {});

    return next;
  });
}

module.exports = {
  sendZohoMail,
  isZohoMailConfigured,
  getZohoMailConfig,
  getMailAccountId,
  uploadZohoAttachment,
  searchZohoMailConversation,
  loadMailIdentity,
  clearMailAccountCache,
};
