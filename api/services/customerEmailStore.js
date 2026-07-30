const { query } = require("../config/db");

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatRow(row) {
  let attachmentNames = [];
  if (row.attachment_names) {
    try {
      attachmentNames =
        typeof row.attachment_names === "string"
          ? JSON.parse(row.attachment_names)
          : row.attachment_names;
    } catch {
      attachmentNames = [];
    }
  }
  if (!Array.isArray(attachmentNames)) attachmentNames = [];

  return {
    id: `local-${row.id}`,
    localId: Number(row.id),
    source: "local",
    direction: row.direction,
    fromAddress: row.from_address,
    toAddress: row.to_address,
    subject: row.subject,
    summary: row.body_text || stripHtml(row.body_html).slice(0, 240),
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    attachmentNames,
    zohoMessageId: row.zoho_message_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

async function createMessage({
  customerId,
  direction = "outbound",
  fromAddress,
  toAddress,
  subject,
  bodyHtml = null,
  bodyText = null,
  attachmentNames = [],
  zohoMessageId = null,
  status = "sent",
  createdBy = null,
}) {
  const text = bodyText || stripHtml(bodyHtml);
  const result = await query(
    `INSERT INTO customer_email_messages
      (customer_id, direction, from_address, to_address, subject, body_html, body_text,
       attachment_names, zoho_message_id, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      customerId,
      direction,
      String(fromAddress || "").slice(0, 255),
      String(toAddress || "").slice(0, 255),
      String(subject || "").slice(0, 500),
      bodyHtml,
      text ? String(text).slice(0, 65000) : null,
      JSON.stringify(attachmentNames || []),
      zohoMessageId ? String(zohoMessageId).slice(0, 128) : null,
      status,
      createdBy,
    ]
  );
  const id = result.insertId;
  const rows = await query(`SELECT * FROM customer_email_messages WHERE id = ?`, [id]);
  return formatRow(rows[0]);
}

async function listByCustomerId(customerId, { limit = 80 } = {}) {
  const rows = await query(
    `SELECT * FROM customer_email_messages
     WHERE customer_id = ?
     ORDER BY created_at ASC, id ASC
     LIMIT ?`,
    [customerId, Math.min(200, Math.max(1, limit))]
  );
  return rows.map(formatRow);
}

module.exports = {
  createMessage,
  listByCustomerId,
  stripHtml,
  formatRow,
};
