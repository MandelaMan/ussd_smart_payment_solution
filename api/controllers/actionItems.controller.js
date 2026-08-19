const store = require("../services/actionItemStore");
const notificationStore = require("../services/notificationStore");
const webPushService = require("../services/webPushService");

async function listTypes(req, res, next) {
  try {
    const types = await store.listTypes();
    return res.json({ ok: true, types });
  } catch (err) {
    return next(err);
  }
}

async function listAssignees(req, res, next) {
  try {
    const users = await store.listAssignableUsers();
    return res.json({ ok: true, users });
  } catch (err) {
    return next(err);
  }
}

async function listActionItems(req, res, next) {
  try {
    const mine =
      req.query.mine === "1" || req.query.mine === "true" || req.query.scope === "mine";
    const result = await store.listActionItems({
      status: req.query.status,
      typeKey: req.query.typeKey,
      customerId: req.query.customerId,
      assignedTo: req.query.assignedTo,
      mineUserId: mine ? req.user?.id : undefined,
      q: req.query.q,
      from: req.query.from,
      to: req.query.to,
      overdue: req.query.overdue,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function getActionItem(req, res, next) {
  try {
    const item = await store.getById(req.params.id);
    if (!item) return res.status(404).json({ error: "Reminder not found" });
    return res.json({ ok: true, actionItem: item });
  } catch (err) {
    return next(err);
  }
}

async function createActionItem(req, res, next) {
  try {
    const item = await store.createActionItem(req.body || {}, { actor: req.user });
    return res.status(201).json({ ok: true, actionItem: item });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function updateActionItem(req, res, next) {
  try {
    const item = await store.updateActionItem(req.params.id, req.body || {}, {
      actor: req.user,
    });
    return res.json({ ok: true, actionItem: item });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function assignActionItem(req, res, next) {
  try {
    const ids = req.body?.assigneeIds || req.body?.taggedUserIds || [];
    const item = await store.replaceAssignees(req.params.id, ids, { actor: req.user });
    return res.json({ ok: true, actionItem: item });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function updateStep(req, res, next) {
  try {
    const item = await store.updateStep(req.params.id, req.params.stepId, req.body || {}, {
      actor: req.user,
    });
    return res.json({ ok: true, actionItem: item });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function addStep(req, res, next) {
  try {
    const item = await store.addStep(req.params.id, req.body || {}, { actor: req.user });
    return res.json({ ok: true, actionItem: item });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function listNotifications(req, res, next) {
  try {
    const unreadOnly = req.query.unread === "1" || req.query.unread === "true";
    const notifications = await notificationStore.listForUser(req.user.id, {
      unreadOnly,
      limit: req.query.limit,
    });
    const unread = await notificationStore.unreadCount(req.user.id);
    return res.json({ ok: true, notifications, unreadCount: unread });
  } catch (err) {
    return next(err);
  }
}

async function unreadCount(req, res, next) {
  try {
    const count = await notificationStore.unreadCount(req.user.id);
    return res.json({ ok: true, unreadCount: count });
  } catch (err) {
    return next(err);
  }
}

async function markNotificationsRead(req, res, next) {
  try {
    await notificationStore.markRead(req.user.id, {
      ids: req.body?.ids,
      all: Boolean(req.body?.all),
    });
    const count = await notificationStore.unreadCount(req.user.id);
    return res.json({ ok: true, unreadCount: count });
  } catch (err) {
    return next(err);
  }
}

async function getVapidPublicKey(req, res, next) {
  try {
    const publicKey = await webPushService.getPublicKey();
    return res.json({ ok: true, publicKey, configured: Boolean(publicKey) });
  } catch (err) {
    return next(err);
  }
}

async function subscribePush(req, res, next) {
  try {
    await webPushService.saveSubscription(req.user.id, {
      endpoint: req.body?.endpoint,
      keys: req.body?.keys,
      userAgent: req.get("user-agent"),
    });
    return res.json({ ok: true });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function unsubscribePush(req, res, next) {
  try {
    await webPushService.deleteSubscription(req.user.id, req.body?.endpoint);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listTypes,
  listAssignees,
  listActionItems,
  getActionItem,
  createActionItem,
  updateActionItem,
  assignActionItem,
  updateStep,
  addStep,
  listNotifications,
  unreadCount,
  markNotificationsRead,
  getVapidPublicKey,
  subscribePush,
  unsubscribePush,
};
