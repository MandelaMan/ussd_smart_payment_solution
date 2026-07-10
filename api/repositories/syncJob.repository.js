const { query } = require("../config/db");

async function createSyncJob({
  integration,
  jobId = null,
  correlationId = null,
  metadata = null,
}) {
  const result = await query(
    `INSERT INTO sync_jobs
      (integration, job_id, status, correlation_id, metadata, started_at)
     VALUES (?, ?, 'queued', ?, ?, NULL)`,
    [integration, jobId, correlationId, metadata ? JSON.stringify(metadata) : null]
  );
  return result.insertId;
}

async function markSyncJobRunning(id, jobId = null) {
  await query(
    `UPDATE sync_jobs
     SET status = 'running', started_at = COALESCE(started_at, NOW()), job_id = COALESCE(?, job_id)
     WHERE id = ?`,
    [jobId, id]
  );
}

async function markSyncJobRetrying(id, lastError) {
  await query(
    `UPDATE sync_jobs SET status = 'retrying', last_error = ? WHERE id = ?`,
    [lastError, id]
  );
}

async function completeSyncJob(id, {
  recordsProcessed = 0,
  recordsCreated = 0,
  recordsUpdated = 0,
  recordsFailed = 0,
  lastSyncedAt = null,
  lastError = null,
  status = "completed",
} = {}) {
  await query(
    `UPDATE sync_jobs
     SET status = ?,
         completed_at = NOW(),
         duration_ms = TIMESTAMPDIFF(MICROSECOND, started_at, NOW()) DIV 1000,
         records_processed = ?,
         records_created = ?,
         records_updated = ?,
         records_failed = ?,
         last_synced_at = ?,
         last_error = ?
     WHERE id = ?`,
    [
      status,
      recordsProcessed,
      recordsCreated,
      recordsUpdated,
      recordsFailed,
      lastSyncedAt,
      lastError,
      id,
    ]
  );
}

async function failSyncJob(id, lastError) {
  await completeSyncJob(id, {
    status: "failed",
    lastError,
  });
}

async function updateSyncJobProgress(id, {
  recordsProcessed,
  recordsCreated,
  recordsUpdated,
  recordsFailed,
} = {}) {
  const fields = [];
  const params = [];
  if (recordsProcessed != null) {
    fields.push("records_processed = ?");
    params.push(recordsProcessed);
  }
  if (recordsCreated != null) {
    fields.push("records_created = ?");
    params.push(recordsCreated);
  }
  if (recordsUpdated != null) {
    fields.push("records_updated = ?");
    params.push(recordsUpdated);
  }
  if (recordsFailed != null) {
    fields.push("records_failed = ?");
    params.push(recordsFailed);
  }
  if (!fields.length) return;
  params.push(id);
  await query(`UPDATE sync_jobs SET ${fields.join(", ")} WHERE id = ?`, params);
}

async function getLatestSyncJob(integration) {
  const rows = await query(
    `SELECT * FROM sync_jobs WHERE integration = ? ORDER BY id DESC LIMIT 1`,
    [integration]
  );
  return rows[0] || null;
}

async function getRunningSyncJobs() {
  return query(
    `SELECT * FROM sync_jobs WHERE status IN ('queued', 'running', 'retrying') ORDER BY started_at DESC`
  );
}

async function listRecentSyncJobs({ integration = null, limit = 50 } = {}) {
  const params = [];
  let sql = `SELECT * FROM sync_jobs`;
  if (integration) {
    sql += ` WHERE integration = ?`;
    params.push(integration);
  }
  sql += ` ORDER BY id DESC LIMIT ?`;
  params.push(Math.min(200, Math.max(1, limit)));
  return query(sql, params);
}

async function getSyncJobById(id) {
  const rows = await query(`SELECT * FROM sync_jobs WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

function mapSyncJobRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    integration: row.integration,
    jobId: row.job_id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    recordsProcessed: row.records_processed,
    recordsCreated: row.records_created,
    recordsUpdated: row.records_updated,
    recordsFailed: row.records_failed,
    lastError: row.last_error,
    lastSyncedAt: row.last_synced_at,
    correlationId: row.correlation_id,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

module.exports = {
  createSyncJob,
  markSyncJobRunning,
  markSyncJobRetrying,
  completeSyncJob,
  failSyncJob,
  updateSyncJobProgress,
  getLatestSyncJob,
  getRunningSyncJobs,
  listRecentSyncJobs,
  getSyncJobById,
  mapSyncJobRow,
};
