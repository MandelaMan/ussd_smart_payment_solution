/**
 * Phase 3 — scheduled report delivery + subscriptions.
 * Email send is queued / logged until mail transport is fully wired.
 */
const { query } = require("../config/db");
const { getReportDefinition, runReport } = require("./reportStore");
const { toExcel, toPdf, toCsv } = require("../utils/reportExport");

let ensured = false;

async function ensureScheduleTables() {
  if (ensured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS report_schedules (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      report_id VARCHAR(128) NOT NULL,
      title VARCHAR(255) NOT NULL,
      format ENUM('xlsx','pdf','csv') NOT NULL DEFAULT 'xlsx',
      cron_expr VARCHAR(64) NOT NULL DEFAULT '0 7 1 * *',
      timezone VARCHAR(64) NOT NULL DEFAULT 'Africa/Nairobi',
      recipients_json JSON NOT NULL,
      params_json JSON NULL,
      created_by INT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      last_run_at DATETIME NULL,
      next_run_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_report_schedules_active (active, next_run_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS report_schedule_runs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      schedule_id BIGINT UNSIGNED NOT NULL,
      status ENUM('queued','sent','failed','skipped') NOT NULL DEFAULT 'queued',
      detail VARCHAR(512) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_schedule_runs_schedule (schedule_id),
      CONSTRAINT fk_schedule_runs_schedule
        FOREIGN KEY (schedule_id) REFERENCES report_schedules(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  ensured = true;
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function listSchedules({ activeOnly = false } = {}) {
  await ensureScheduleTables();
  const rows = await query(
    `SELECT * FROM report_schedules
     ${activeOnly ? "WHERE active = 1" : ""}
     ORDER BY updated_at DESC
     LIMIT 200`
  );
  return rows.map((r) => ({
    id: r.id,
    reportId: r.report_id,
    title: r.title,
    format: r.format,
    cronExpr: r.cron_expr,
    timezone: r.timezone,
    recipients: parseJson(r.recipients_json, []),
    params: parseJson(r.params_json, {}),
    createdBy: r.created_by,
    active: Boolean(r.active),
    lastRunAt: r.last_run_at,
    nextRunAt: r.next_run_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

async function createSchedule(input, userId) {
  await ensureScheduleTables();
  const def = getReportDefinition(input.reportId);
  if (!def || def.available === false) {
    throw new Error("Report is not available for scheduling.");
  }
  const recipients = Array.isArray(input.recipients)
    ? input.recipients.map((e) => String(e).trim()).filter(Boolean)
    : [];
  if (!recipients.length) throw new Error("At least one recipient email is required.");

  const format = ["xlsx", "pdf", "csv"].includes(input.format) ? input.format : "xlsx";
  const title = input.title || `${def.title} schedule`;
  const cronExpr = input.cronExpr || "0 7 1 * *";
  const timezone = input.timezone || "Africa/Nairobi";
  const params = input.params || {};

  const result = await query(
    `INSERT INTO report_schedules
      (report_id, title, format, cron_expr, timezone, recipients_json, params_json, created_by, active, next_run_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, DATE_ADD(NOW(), INTERVAL 1 DAY))`,
    [
      input.reportId,
      title,
      format,
      cronExpr,
      timezone,
      JSON.stringify(recipients),
      JSON.stringify(params),
      userId || null,
    ]
  );

  const insertId = result?.insertId;
  if (!insertId) {
    const [row] = await query(
      `SELECT id FROM report_schedules WHERE report_id = ? ORDER BY id DESC LIMIT 1`,
      [input.reportId]
    );
    return getSchedule(row.id);
  }
  return getSchedule(insertId);
}

async function getSchedule(id) {
  await ensureScheduleTables();
  const [row] = await query(`SELECT * FROM report_schedules WHERE id = ?`, [id]);
  if (!row) return null;
  return {
    id: row.id,
    reportId: row.report_id,
    title: row.title,
    format: row.format,
    cronExpr: row.cron_expr,
    timezone: row.timezone,
    recipients: parseJson(row.recipients_json, []),
    params: parseJson(row.params_json, {}),
    createdBy: row.created_by,
    active: Boolean(row.active),
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function setScheduleActive(id, active) {
  await ensureScheduleTables();
  await query(`UPDATE report_schedules SET active = ? WHERE id = ?`, [active ? 1 : 0, id]);
  return getSchedule(id);
}

async function deleteSchedule(id) {
  await ensureScheduleTables();
  await query(`DELETE FROM report_schedules WHERE id = ?`, [id]);
  return { ok: true };
}

/**
 * Execute a schedule: generate report bytes and record a run.
 * Delivery is marked queued until Zoho Mail / SMTP subscription is connected.
 */
async function runScheduleNow(id) {
  await ensureScheduleTables();
  const schedule = await getSchedule(id);
  if (!schedule) throw new Error("Schedule not found.");

  const report = await runReport(schedule.reportId, schedule.params || {});
  if (!report) throw new Error("Report runner returned empty.");

  let bytes;
  if (schedule.format === "pdf") bytes = await toPdf(report);
  else if (schedule.format === "csv") bytes = toCsv(report);
  else bytes = await toExcel(report);

  await query(
    `INSERT INTO report_schedule_runs (schedule_id, status, detail) VALUES (?, 'queued', ?)`,
    [
      id,
      `Generated ${schedule.format} (${Buffer.byteLength(bytes)} bytes) for ${schedule.recipients.join(", ")}. Email delivery pending mail transport.`,
    ]
  );
  await query(
    `UPDATE report_schedules SET last_run_at = NOW(), next_run_at = DATE_ADD(NOW(), INTERVAL 1 DAY) WHERE id = ?`,
    [id]
  );

  return {
    ok: true,
    scheduleId: id,
    format: schedule.format,
    byteLength: Buffer.byteLength(bytes),
    recipients: schedule.recipients,
    delivery: "queued",
    message:
      "Report generated and queued for email. Connect mail transport to enable automatic send.",
  };
}

async function listScheduleRuns(scheduleId, limit = 20) {
  await ensureScheduleTables();
  return query(
    `SELECT id, schedule_id AS scheduleId, status, detail, created_at AS createdAt
     FROM report_schedule_runs
     WHERE schedule_id = ?
     ORDER BY id DESC
     LIMIT ?`,
    [scheduleId, limit]
  );
}

module.exports = {
  ensureScheduleTables,
  listSchedules,
  createSchedule,
  getSchedule,
  setScheduleActive,
  deleteSchedule,
  runScheduleNow,
  listScheduleRuns,
};
