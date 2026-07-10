const { query } = require("../config/db");

async function getIntegrationState(integration) {
  const rows = await query(
    `SELECT * FROM integration_sync_state WHERE integration = ? LIMIT 1`,
    [integration]
  );
  return rows[0] || null;
}

async function upsertIntegrationState(integration, patch = {}) {
  const existing = await getIntegrationState(integration);
  if (!existing) {
    await query(
      `INSERT INTO integration_sync_state
        (integration, status, last_synced_at, last_attempt_at, last_success_at, last_error, records_updated, sync_cursor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        integration,
        patch.status || "idle",
        patch.lastSyncedAt || null,
        patch.lastAttemptAt || null,
        patch.lastSuccessAt || null,
        patch.lastError || null,
        patch.recordsUpdated != null ? patch.recordsUpdated : 0,
        patch.syncCursor ? JSON.stringify(patch.syncCursor) : null,
      ]
    );
    return getIntegrationState(integration);
  }

  const fields = [];
  const params = [];
  if (patch.status !== undefined) {
    fields.push("status = ?");
    params.push(patch.status);
  }
  if (patch.lastSyncedAt !== undefined) {
    fields.push("last_synced_at = ?");
    params.push(patch.lastSyncedAt);
  }
  if (patch.lastAttemptAt !== undefined) {
    fields.push("last_attempt_at = ?");
    params.push(patch.lastAttemptAt);
  }
  if (patch.lastSuccessAt !== undefined) {
    fields.push("last_success_at = ?");
    params.push(patch.lastSuccessAt);
  }
  if (patch.lastError !== undefined) {
    fields.push("last_error = ?");
    params.push(patch.lastError);
  }
  if (patch.recordsUpdated !== undefined) {
    fields.push("records_updated = ?");
    params.push(patch.recordsUpdated);
  }
  if (patch.syncCursor !== undefined) {
    fields.push("sync_cursor = ?");
    params.push(patch.syncCursor ? JSON.stringify(patch.syncCursor) : null);
  }
  if (!fields.length) return existing;
  params.push(integration);
  await query(
    `UPDATE integration_sync_state SET ${fields.join(", ")} WHERE integration = ?`,
    params
  );
  return getIntegrationState(integration);
}

async function getAllIntegrationStates() {
  return query(`SELECT * FROM integration_sync_state ORDER BY integration ASC`);
}

function mapIntegrationStateRow(row) {
  if (!row) return null;
  let syncCursor = null;
  if (row.sync_cursor) {
    try {
      syncCursor =
        typeof row.sync_cursor === "object"
          ? row.sync_cursor
          : JSON.parse(row.sync_cursor);
    } catch {
      syncCursor = null;
    }
  }
  return {
    integration: row.integration,
    status: row.status || "idle",
    lastSyncedAt: row.last_synced_at,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    recordsUpdated: row.records_updated != null ? Number(row.records_updated) : 0,
    syncCursor,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  getIntegrationState,
  upsertIntegrationState,
  getAllIntegrationStates,
  mapIntegrationStateRow,
};
