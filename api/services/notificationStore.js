const { query } = require("../config/db");
const { emitToUser } = require("../lib/adminEvents");
const webPushService = require("./webPushService");

function mapRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    type: row.type,
    title: row.title,
    body: row.body || "",
    actionItemId: row.action_item_id != null ? Number(row.action_item_id) : null,
    isRead: Boolean(row.is_read),
    createdAt: row.created_at,
  };
}

async function listActiveUserIdsForAdminOrGroup(groupSlug) {
  const slug = String(groupSlug || "").trim();
  if (!slug) return [];
  const rows = await query(
    `SELECT DISTINCT u.id
     FROM admin_users u
     LEFT JOIN rbac_user_groups ug ON ug.user_id = u.id
     LEFT JOIN rbac_groups g ON g.id = ug.group_id AND g.is_active = 1
     WHERE u.is_active = 1
       AND (u.role = 'admin' OR g.slug = ?)`,
    [slug]
  );
  return rows.map((row) => Number(row.id)).filter((id) => id > 0);
}

async function createNotifications({
  userIds,
  type,
  title,
  body = "",
  actionItemId = null,
  push = null,
} = {}) {
  const ids = [...new Set((userIds || []).map((id) => Number(id)).filter((id) => id > 0))];
  if (!ids.length) return [];

  const created = [];
  const createdAt = new Date().toISOString();
  for (const userId of ids) {
    const result = await query(
      `INSERT INTO user_notifications (user_id, type, title, body, action_item_id)
       VALUES (?, ?, ?, ?, ?)`,
      [
        userId,
        String(type || "action_item").slice(0, 64),
        String(title || "Reminder").slice(0, 255),
        body ? String(body).slice(0, 2000) : null,
        actionItemId != null ? Number(actionItemId) : null,
      ]
    );
    const notification = {
      id: Number(result.insertId),
      userId,
      type: String(type || "action_item"),
      title: String(title || "Reminder"),
      body: body || "",
      actionItemId: actionItemId != null ? Number(actionItemId) : null,
      isRead: false,
      createdAt,
    };
    created.push(notification);
    emitToUser(userId, "admin:notifications", {
      action: "created",
      type: notification.type,
      actionItemId: notification.actionItemId,
      title: notification.title,
      notification,
    });
  }

  if (push) {
    webPushService
      .sendToUsers(ids, {
        title: push.title || title,
        body: push.body || body,
        url: push.url || (actionItemId ? `/admin/reminders?id=${actionItemId}` : "/admin/reminders"),
        actionItemId,
      })
      .catch((err) => console.warn("push notify failed:", err?.message || err));
  }

  return created;
}

async function listForUser(userId, { unreadOnly = false, limit = 40 } = {}) {
  const clauses = ["user_id = ?"];
  const params = [Number(userId)];
  if (unreadOnly) clauses.push("is_read = 0");
  const take = Math.min(100, Math.max(1, Number(limit) || 40));
  const rows = await query(
    `SELECT * FROM user_notifications
     WHERE ${clauses.join(" AND ")}
     ORDER BY created_at DESC, id DESC
     LIMIT ${take}`,
    params
  );
  return rows.map(mapRow);
}

async function unreadCount(userId) {
  const rows = await query(
    `SELECT COUNT(*) AS n FROM user_notifications WHERE user_id = ? AND is_read = 0`,
    [Number(userId)]
  );
  return Number(rows[0]?.n || 0);
}

async function markRead(userId, { ids = null, all = false } = {}) {
  if (all) {
    await query(
      `UPDATE user_notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`,
      [Number(userId)]
    );
    return { ok: true };
  }
  const list = (ids || []).map((id) => Number(id)).filter((id) => id > 0);
  if (!list.length) return { ok: true };
  const placeholders = list.map(() => "?").join(",");
  await query(
    `UPDATE user_notifications
     SET is_read = 1
     WHERE user_id = ? AND id IN (${placeholders})`,
    [Number(userId), ...list]
  );
  return { ok: true };
}

module.exports = {
  createNotifications,
  listActiveUserIdsForAdminOrGroup,
  listForUser,
  unreadCount,
  markRead,
};
