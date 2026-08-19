const crypto = require("crypto");
const { query } = require("../config/db");
const { getSetting, setSetting } = require("./appSettingsStore");

const VAPID_SETTING_KEY = "push.vapid";
const DEFAULT_SUBJECT = "mailto:support@sulsolutions.biz";

function hashEndpoint(endpoint) {
  return crypto.createHash("sha256").update(String(endpoint || "")).digest("hex");
}

function loadWebPush() {
  try {
    return require("web-push");
  } catch {
    return null;
  }
}

async function getVapidKeys() {
  const envPublic = String(process.env.VAPID_PUBLIC_KEY || "").trim();
  const envPrivate = String(process.env.VAPID_PRIVATE_KEY || "").trim();
  if (envPublic && envPrivate) {
    return {
      publicKey: envPublic,
      privateKey: envPrivate,
      subject: String(process.env.VAPID_SUBJECT || "").trim() || DEFAULT_SUBJECT,
    };
  }

  const saved = (await getSetting(VAPID_SETTING_KEY)) || {};
  if (saved.publicKey && saved.privateKey) {
    return {
      publicKey: String(saved.publicKey),
      privateKey: String(saved.privateKey),
      subject: String(saved.subject || "").trim() || DEFAULT_SUBJECT,
    };
  }

  const webpush = loadWebPush();
  if (!webpush) return null;

  const generated = webpush.generateVAPIDKeys();
  const next = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject: DEFAULT_SUBJECT,
  };
  await setSetting(VAPID_SETTING_KEY, next, null);
  return next;
}

async function getPublicKey() {
  const keys = await getVapidKeys();
  return keys?.publicKey || null;
}

async function saveSubscription(userId, { endpoint, keys, userAgent } = {}) {
  const ep = String(endpoint || "").trim();
  const p256dh = String(keys?.p256dh || "").trim();
  const auth = String(keys?.auth || "").trim();
  if (!ep || !p256dh || !auth) {
    throw new Error("Push subscription is incomplete");
  }
  const hash = hashEndpoint(ep);
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, endpoint_hash, p256dh, auth, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id),
       endpoint = VALUES(endpoint),
       p256dh = VALUES(p256dh),
       auth = VALUES(auth),
       user_agent = VALUES(user_agent)`,
    [Number(userId), ep, hash, p256dh, auth, String(userAgent || "").slice(0, 255) || null]
  );
  return { ok: true };
}

async function deleteSubscription(userId, endpoint) {
  const ep = String(endpoint || "").trim();
  if (!ep) {
    await query(`DELETE FROM push_subscriptions WHERE user_id = ?`, [Number(userId)]);
    return { ok: true };
  }
  await query(
    `DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint_hash = ?`,
    [Number(userId), hashEndpoint(ep)]
  );
  return { ok: true };
}

async function sendToUsers(userIds, payload) {
  const ids = [...new Set((userIds || []).map((id) => Number(id)).filter((id) => id > 0))];
  if (!ids.length) return { sent: 0 };

  const webpush = loadWebPush();
  const keys = await getVapidKeys();
  if (!webpush || !keys) return { sent: 0, skipped: true };

  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);

  const placeholders = ids.map(() => "?").join(",");
  const rows = await query(
    `SELECT id, user_id, endpoint, p256dh, auth
     FROM push_subscriptions
     WHERE user_id IN (${placeholders})`,
    ids
  );

  const body = JSON.stringify({
    title: String(payload.title || "SUL Bix"),
    body: String(payload.body || ""),
    url: String(payload.url || "/admin/reminders"),
    actionItemId: payload.actionItemId || null,
  });

  let sent = 0;
  for (const row of rows) {
    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        body,
        { TTL: 60 * 60 * 12 }
      );
      sent += 1;
    } catch (err) {
      const status = err?.statusCode || err?.status;
      if (status === 404 || status === 410) {
        await query(`DELETE FROM push_subscriptions WHERE id = ?`, [row.id]).catch(() => {});
      } else {
        console.warn("web push failed:", err?.message || err);
      }
    }
  }
  return { sent };
}

module.exports = {
  getPublicKey,
  saveSubscription,
  deleteSubscription,
  sendToUsers,
};
