const { emitSyncEvent, emitToUser, emitToUsers } = require("../socket");

/**
 * Broadcast admin data changes to all connected admin clients.
 * Events are emitted on the shared sync-updates room as admin:{resource}.
 */
function emitAdminUpdate(resource, payload = {}) {
  emitSyncEvent(`admin:${resource}`, {
    resource,
    ts: Date.now(),
    ...payload,
  });
}

module.exports = { emitAdminUpdate, emitToUser, emitToUsers };
