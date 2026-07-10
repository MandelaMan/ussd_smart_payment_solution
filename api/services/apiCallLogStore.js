const { query } = require("../config/db");

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function formatLog(row) {
  return {
    id: row.id,
    service: row.service,
    operation: row.operation,
    method: row.method,
    endpoint: row.endpoint,
    status: row.status,
    httpStatus: row.http_status,
    requestPayload: parseJson(row.request_payload, {}),
    responsePayload: parseJson(row.response_payload, null),
    errorMessage: row.error_message,
    customerId: row.customer_id,
    customerNumber: row.customer_number,
    referenceId: row.reference_id,
    retryable: Boolean(row.retryable),
    retryCount: row.retry_count,
    parentLogId: row.parent_log_id,
    createdAt: row.created_at,
  };
}

async function insertApiCallLog({
  service,
  operation,
  method = "POST",
  endpoint,
  status,
  httpStatus = null,
  requestPayload = {},
  responsePayload = null,
  errorMessage = null,
  customerId = null,
  customerNumber = null,
  referenceId = null,
  retryable = true,
  parentLogId = null,
}) {
  const result = await query(
    `INSERT INTO api_call_logs
      (service, operation, method, endpoint, status, http_status,
       request_payload, response_payload, error_message,
       customer_id, customer_number, reference_id, retryable, parent_log_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      service,
      operation,
      method,
      endpoint,
      status,
      httpStatus,
      JSON.stringify(requestPayload ?? {}),
      responsePayload != null ? JSON.stringify(responsePayload) : null,
      errorMessage,
      customerId,
      customerNumber,
      referenceId,
      retryable ? 1 : 0,
      parentLogId,
    ]
  );
  return result.insertId;
}

async function incrementRetryCount(id) {
  await query(`UPDATE api_call_logs SET retry_count = retry_count + 1 WHERE id = ?`, [
    id,
  ]);
}

async function getApiCallLogById(id) {
  const rows = await query(`SELECT * FROM api_call_logs WHERE id = ? LIMIT 1`, [id]);
  return rows[0] ? formatLog(rows[0]) : null;
}

async function listApiCallLogs({
  service,
  status,
  operation,
  search,
  from,
  to,
  page = 1,
  limit = 20,
  sortBy,
  sortDir,
}) {
  const conditions = [];
  const params = [];

  if (service) {
    conditions.push("service = ?");
    params.push(service);
  }
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }
  if (operation) {
    conditions.push("operation = ?");
    params.push(operation);
  }
  if (from) {
    conditions.push("created_at >= ?");
    params.push(from);
  }
  if (to) {
    conditions.push("created_at <= ?");
    params.push(to);
  }
  if (search) {
    conditions.push(
      "(endpoint LIKE ? OR operation LIKE ? OR customer_number LIKE ? OR reference_id LIKE ? OR error_message LIKE ?)"
    );
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = (Math.max(1, page) - 1) * limit;

  const { resolveListSort } = require("../utils/listSort");
  const sort = resolveListSort(
    { sortBy, sortDir },
    {
      allowed: [
        { key: "operation", sql: "operation" },
        { key: "endpoint", sql: "endpoint" },
        { key: "service", sql: "service" },
        { key: "createdAt", sql: "created_at" },
        { key: "customerNumber", sql: "customer_number" },
        { key: "status", sql: "status" },
      ],
      defaultSort: { sortBy: "createdAt", sortDir: "desc" },
    }
  );

  const countRows = await query(
    `SELECT COUNT(*) AS total FROM api_call_logs ${where}`,
    params
  );
  const total = Number(countRows[0]?.total || 0);

  const rows = await query(
    `SELECT * FROM api_call_logs ${where} ORDER BY ${sort.orderClause} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    data: rows.map(formatLog),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  };
}

module.exports = {
  insertApiCallLog,
  incrementRetryCount,
  getApiCallLogById,
  listApiCallLogs,
  formatLog,
};
