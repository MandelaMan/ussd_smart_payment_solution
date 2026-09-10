const { query } = require("../config/db");
const { resolveListSort } = require("../utils/listSort");

const LEAD_STATUSES = [
  "new",
  "interested",
  "contacted",
  "qualified",
  "converted",
  "closed",
];
const LEAD_SOURCES = ["whatsapp", "web", "embed", "email", "signup", "manual"];
const TERMINAL_LEAD_STATUSES = ["converted", "closed"];

function parseMetadata(row) {
  if (!row) return row;
  if (row.metadata != null && typeof row.metadata === "string") {
    try {
      row.metadata = JSON.parse(row.metadata);
    } catch {
      row.metadata = null;
    }
  }
  return row;
}

async function listLeads(filters = {}) {
  const clauses = ["1=1"];
  const params = [];

  if (filters.status && LEAD_STATUSES.includes(String(filters.status))) {
    clauses.push("l.status = ?");
    params.push(filters.status);
  }
  if (filters.source && LEAD_SOURCES.includes(String(filters.source))) {
    clauses.push("l.source = ?");
    params.push(filters.source);
  }
  if (filters.hasEmail === true || filters.hasEmail === "1" || filters.hasEmail === "true") {
    clauses.push("l.email IS NOT NULL AND TRIM(l.email) <> ''");
  }
  if (filters.search) {
    const q = `%${String(filters.search).trim()}%`;
    clauses.push(
      "(l.name LIKE ? OR l.phone LIKE ? OR l.email LIKE ? OR l.interest LIKE ? OR l.message LIKE ? OR l.apartment_number LIKE ? OR l.block LIKE ? OR l.building_interest LIKE ?)"
    );
    params.push(q, q, q, q, q, q, q, q);
  }

  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
  const offset = (page - 1) * limit;

  const sort = resolveListSort(filters, {
    allowed: [
      { key: "createdAt", sql: "l.created_at" },
      { key: "updatedAt", sql: "l.updated_at" },
      { key: "name", sql: "l.name" },
      { key: "status", sql: "l.status" },
      { key: "source", sql: "l.source" },
    ],
    defaultSort: { sortBy: "createdAt", sortDir: "desc" },
  });

  const [countRow] = await query(
    `SELECT COUNT(*) AS total FROM leads l WHERE ${clauses.join(" AND ")}`,
    params
  );

  const leads = await query(
    `SELECT l.id, l.source, l.status, l.name, l.phone, l.email, l.interest,
            l.building_interest AS buildingInterest,
            l.apartment_number AS apartmentNumber,
            l.block AS block,
            l.building_id AS buildingId,
            b.name AS buildingName,
            l.message, l.notes,
            l.whatsapp_wa_id AS whatsappWaId,
            l.conversation_state AS conversationState,
            l.metadata, l.converted_customer_id AS convertedCustomerId,
            l.assigned_to AS assignedTo,
            l.created_at AS createdAt, l.updated_at AS updatedAt,
            (SELECT COUNT(*) FROM lead_messages m WHERE m.lead_id = l.id) AS messageCount,
            (SELECT m.body FROM lead_messages m WHERE m.lead_id = l.id ORDER BY m.id DESC LIMIT 1) AS lastMessage,
            (SELECT m.created_at FROM lead_messages m WHERE m.lead_id = l.id ORDER BY m.id DESC LIMIT 1) AS lastMessageAt,
            (SELECT m.direction FROM lead_messages m WHERE m.lead_id = l.id ORDER BY m.id DESC LIMIT 1) AS lastMessageDirection
     FROM leads l
     LEFT JOIN buildings b ON b.id = l.building_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY ${sort.orderClause}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  for (const lead of leads) {
    parseMetadata(lead);
    lead.messageCount = Number(lead.messageCount || 0);
  }

  return {
    leads,
    data: leads,
    pagination: {
      page,
      limit,
      total: Number(countRow.total),
      pages: Math.ceil(Number(countRow.total) / limit) || 1,
    },
  };
}

async function getLeadById(id) {
  const rows = await query(
    `SELECT l.id, l.source, l.status, l.name, l.phone, l.email, l.interest,
            l.building_interest AS buildingInterest,
            l.apartment_number AS apartmentNumber,
            l.block AS block,
            l.building_id AS buildingId,
            b.name AS buildingName,
            l.message, l.notes,
            l.whatsapp_wa_id AS whatsappWaId,
            l.conversation_state AS conversationState,
            l.metadata, l.converted_customer_id AS convertedCustomerId,
            l.assigned_to AS assignedTo,
            l.created_at AS createdAt, l.updated_at AS updatedAt
     FROM leads l
     LEFT JOIN buildings b ON b.id = l.building_id
     WHERE l.id = ?
     LIMIT 1`,
    [id]
  );
  return parseMetadata(rows[0] || null);
}

async function getLeadByWhatsAppWaId(waId) {
  if (!waId) return null;
  const rows = await query(
    `SELECT l.id, l.source, l.status, l.name, l.phone, l.email, l.interest,
            l.building_interest AS buildingInterest,
            l.apartment_number AS apartmentNumber,
            l.block AS block,
            l.building_id AS buildingId,
            b.name AS buildingName,
            l.message, l.notes,
            l.whatsapp_wa_id AS whatsappWaId,
            l.conversation_state AS conversationState,
            l.metadata, l.converted_customer_id AS convertedCustomerId,
            l.assigned_to AS assignedTo,
            l.created_at AS createdAt, l.updated_at AS updatedAt
     FROM leads l
     LEFT JOIN buildings b ON b.id = l.building_id
     WHERE l.whatsapp_wa_id = ?
     ORDER BY l.id DESC
     LIMIT 1`,
    [String(waId)]
  );
  return parseMetadata(rows[0] || null);
}

async function getLeadByEmail(email) {
  const address = String(email || "")
    .trim()
    .toLowerCase();
  if (!address.includes("@")) return null;
  const rows = await query(
    `SELECT l.id, l.source, l.status, l.name, l.phone, l.email, l.interest,
            l.building_interest AS buildingInterest,
            l.apartment_number AS apartmentNumber,
            l.block AS block,
            l.building_id AS buildingId,
            b.name AS buildingName,
            l.message, l.notes,
            l.whatsapp_wa_id AS whatsappWaId,
            l.conversation_state AS conversationState,
            l.metadata, l.converted_customer_id AS convertedCustomerId,
            l.assigned_to AS assignedTo,
            l.created_at AS createdAt, l.updated_at AS updatedAt
     FROM leads l
     LEFT JOIN buildings b ON b.id = l.building_id
     WHERE LOWER(TRIM(l.email)) = ?
     ORDER BY l.id DESC
     LIMIT 1`,
    [address]
  );
  return parseMetadata(rows[0] || null);
}

/** Normalize KE-style phones to digits for matching (07… ↔ 2547…). */
function phoneMatchVariants(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return [];
  const variants = new Set([digits]);
  if (digits.startsWith("254") && digits.length >= 12) {
    variants.add(`0${digits.slice(3)}`);
    variants.add(digits.slice(3));
  } else if (digits.startsWith("0") && digits.length >= 10) {
    variants.add(`254${digits.slice(1)}`);
    variants.add(digits.slice(1));
  } else if (digits.length === 9) {
    variants.add(`0${digits}`);
    variants.add(`254${digits}`);
  }
  return [...variants];
}

async function getWhatsAppLeadByPhone(phone) {
  const variants = phoneMatchVariants(phone);
  if (!variants.length) return null;
  const local9 = new Set(
    variants.filter((v) => v.length >= 9).map((v) => v.slice(-9))
  );

  const placeholders = variants.map(() => "?").join(", ");
  const rows = await query(
    `SELECT l.id, l.source, l.status, l.name, l.phone, l.email, l.interest,
            l.building_interest AS buildingInterest, l.message, l.notes,
            l.whatsapp_wa_id AS whatsappWaId,
            l.conversation_state AS conversationState,
            l.metadata, l.converted_customer_id AS convertedCustomerId,
            l.assigned_to AS assignedTo,
            l.created_at AS createdAt, l.updated_at AS updatedAt
     FROM leads l
     WHERE l.source = 'whatsapp'
       AND (
         l.phone IN (${placeholders})
         OR l.whatsapp_wa_id IN (${placeholders})
       )
     ORDER BY l.updated_at DESC, l.id DESC
     LIMIT 1`,
    [...variants, ...variants]
  );
  if (rows[0]) return parseMetadata(rows[0]);

  const recent = await query(
    `SELECT l.id, l.source, l.status, l.name, l.phone, l.email, l.interest,
            l.building_interest AS buildingInterest, l.message, l.notes,
            l.whatsapp_wa_id AS whatsappWaId,
            l.conversation_state AS conversationState,
            l.metadata, l.converted_customer_id AS convertedCustomerId,
            l.assigned_to AS assignedTo,
            l.created_at AS createdAt, l.updated_at AS updatedAt
     FROM leads l
     WHERE l.source = 'whatsapp'
     ORDER BY l.updated_at DESC, l.id DESC
     LIMIT 300`
  );

  for (const row of recent) {
    const candidate = [
      ...phoneMatchVariants(row.phone),
      ...phoneMatchVariants(row.whatsappWaId),
    ];
    if (
      candidate.some(
        (v) => variants.includes(v) || (v.length >= 9 && local9.has(v.slice(-9)))
      )
    ) {
      return parseMetadata(row);
    }
  }
  return null;
}

async function getOpenLeadByPhone(phone) {
  const variants = phoneMatchVariants(phone);
  if (!variants.length) return null;
  const local9 = new Set(
    variants.filter((v) => v.length >= 9).map((v) => v.slice(-9))
  );
  const placeholders = variants.map(() => "?").join(", ");
  const terminal = TERMINAL_LEAD_STATUSES.map(() => "?").join(", ");
  const rows = await query(
    `SELECT l.id, l.source, l.status, l.name, l.phone, l.email, l.interest,
            l.building_interest AS buildingInterest,
            l.apartment_number AS apartmentNumber,
            l.block AS block,
            l.building_id AS buildingId,
            b.name AS buildingName,
            l.message, l.notes,
            l.whatsapp_wa_id AS whatsappWaId,
            l.conversation_state AS conversationState,
            l.metadata, l.converted_customer_id AS convertedCustomerId,
            l.assigned_to AS assignedTo,
            l.created_at AS createdAt, l.updated_at AS updatedAt
     FROM leads l
     LEFT JOIN buildings b ON b.id = l.building_id
     WHERE l.status NOT IN (${terminal})
       AND (
         l.phone IN (${placeholders})
         OR l.whatsapp_wa_id IN (${placeholders})
       )
     ORDER BY (l.source = 'signup') DESC, l.updated_at DESC, l.id DESC
     LIMIT 1`,
    [...TERMINAL_LEAD_STATUSES, ...variants, ...variants]
  );
  if (rows[0]) return parseMetadata(rows[0]);

  const recent = await query(
    `SELECT l.id, l.source, l.status, l.name, l.phone, l.email, l.interest,
            l.building_interest AS buildingInterest,
            l.apartment_number AS apartmentNumber,
            l.block AS block,
            l.building_id AS buildingId,
            b.name AS buildingName,
            l.message, l.notes,
            l.whatsapp_wa_id AS whatsappWaId,
            l.conversation_state AS conversationState,
            l.metadata, l.converted_customer_id AS convertedCustomerId,
            l.assigned_to AS assignedTo,
            l.created_at AS createdAt, l.updated_at AS updatedAt
     FROM leads l
     LEFT JOIN buildings b ON b.id = l.building_id
     WHERE l.status NOT IN (${terminal})
     ORDER BY l.updated_at DESC, l.id DESC
     LIMIT 300`,
    TERMINAL_LEAD_STATUSES
  );

  for (const row of recent) {
    const candidate = [
      ...phoneMatchVariants(row.phone),
      ...phoneMatchVariants(row.whatsappWaId),
    ];
    if (
      candidate.some(
        (v) => variants.includes(v) || (v.length >= 9 && local9.has(v.slice(-9)))
      )
    ) {
      return parseMetadata(row);
    }
  }
  return null;
}

async function createLead(data) {
  const source = LEAD_SOURCES.includes(data.source) ? data.source : "web";
  const metadata =
    data.metadata != null ? JSON.stringify(data.metadata) : null;

  const result = await query(
    `INSERT INTO leads
      (source, status, name, phone, email, interest, building_interest,
       apartment_number, block, building_id, message,
       notes, whatsapp_wa_id, conversation_state, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      source,
      data.status && LEAD_STATUSES.includes(data.status) ? data.status : "new",
      data.name ? String(data.name).trim() : null,
      data.phone ? String(data.phone).trim() : null,
      data.email ? String(data.email).trim().toLowerCase() : null,
      data.interest ? String(data.interest).trim() : null,
      data.buildingInterest ? String(data.buildingInterest).trim() : null,
      data.apartmentNumber ? String(data.apartmentNumber).trim() : null,
      data.block ? String(data.block).trim().slice(0, 50) : null,
      data.buildingId != null && data.buildingId !== ""
        ? Number(data.buildingId)
        : null,
      data.message ? String(data.message).trim() : null,
      data.notes ? String(data.notes).trim() : null,
      data.whatsappWaId ? String(data.whatsappWaId).trim() : null,
      data.conversationState ? String(data.conversationState).trim() : null,
      metadata,
    ]
  );
  return result.insertId;
}

async function updateLead(id, patch = {}) {
  const fields = [];
  const params = [];

  const map = {
    source: "source",
    status: "status",
    name: "name",
    phone: "phone",
    email: "email",
    interest: "interest",
    buildingInterest: "building_interest",
    apartmentNumber: "apartment_number",
    block: "block",
    buildingId: "building_id",
    message: "message",
    notes: "notes",
    whatsappWaId: "whatsapp_wa_id",
    conversationState: "conversation_state",
    convertedCustomerId: "converted_customer_id",
    assignedTo: "assigned_to",
  };

  for (const [key, column] of Object.entries(map)) {
    if (patch[key] === undefined) continue;
    if (key === "status" && patch.status != null && !LEAD_STATUSES.includes(patch.status)) {
      continue;
    }
    if (key === "source" && patch.source != null && !LEAD_SOURCES.includes(patch.source)) {
      continue;
    }
    fields.push(`${column} = ?`);
    params.push(patch[key] === "" || patch[key] === undefined ? null : patch[key]);
  }

  if (patch.metadata !== undefined) {
    fields.push("metadata = ?");
    params.push(
      patch.metadata == null ? null : JSON.stringify(patch.metadata)
    );
  }

  if (!fields.length) return getLeadById(id);

  params.push(id);
  await query(`UPDATE leads SET ${fields.join(", ")} WHERE id = ?`, params);
  return getLeadById(id);
}

async function addMessage({
  leadId,
  direction,
  channel,
  body,
  payload = null,
  externalMessageId = null,
}) {
  const result = await query(
    `INSERT INTO lead_messages
      (lead_id, direction, channel, body, payload, external_message_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      leadId,
      direction,
      channel,
      String(body || "").slice(0, 8000),
      payload != null ? JSON.stringify(payload) : null,
      externalMessageId,
    ]
  );
  return result.insertId;
}

async function listMessages(leadId) {
  const rows = await query(
    `SELECT id, lead_id AS leadId, direction, channel, body, payload,
            external_message_id AS externalMessageId,
            created_at AS createdAt
     FROM lead_messages
     WHERE lead_id = ?
     ORDER BY id ASC`,
    [leadId]
  );
  for (const row of rows) {
    if (row.payload != null && typeof row.payload === "string") {
      try {
        row.payload = JSON.parse(row.payload);
      } catch {
        row.payload = null;
      }
    }
  }
  return rows;
}

async function getLastInboundAt(leadId) {
  const rows = await query(
    `SELECT created_at AS createdAt
     FROM lead_messages
     WHERE lead_id = ? AND direction = 'inbound'
     ORDER BY id DESC
     LIMIT 1`,
    [leadId]
  );
  return rows[0]?.createdAt || null;
}

async function getLeadStats() {
  const rows = await query(
    `SELECT
       COUNT(*) AS total,
       SUM(status = 'new') AS newCount,
       SUM(status = 'interested') AS interestedCount,
       SUM(status = 'contacted') AS contactedCount,
       SUM(status = 'qualified') AS qualifiedCount,
       SUM(status = 'converted') AS convertedCount,
       SUM(status = 'closed') AS closedCount,
       SUM(source = 'whatsapp') AS whatsappCount,
       SUM(source = 'web') AS webCount,
       SUM(source = 'embed') AS embedCount,
       SUM(source = 'email') AS emailCount,
       SUM(source = 'signup') AS signupCount,
       SUM(source = 'manual') AS manualCount,
       SUM(email IS NOT NULL AND TRIM(email) <> '') AS withEmailCount
     FROM leads`
  );
  const r = rows[0] || {};
  return {
    total: Number(r.total || 0),
    byStatus: {
      new: Number(r.newCount || 0),
      interested: Number(r.interestedCount || 0),
      contacted: Number(r.contactedCount || 0),
      qualified: Number(r.qualifiedCount || 0),
      converted: Number(r.convertedCount || 0),
      closed: Number(r.closedCount || 0),
    },
    bySource: {
      whatsapp: Number(r.whatsappCount || 0),
      web: Number(r.webCount || 0),
      embed: Number(r.embedCount || 0),
      email: Number(r.emailCount || 0),
      signup: Number(r.signupCount || 0),
      manual: Number(r.manualCount || 0),
    },
    withEmail: Number(r.withEmailCount || 0),
  };
}

module.exports = {
  LEAD_STATUSES,
  LEAD_SOURCES,
  TERMINAL_LEAD_STATUSES,
  phoneMatchVariants,
  listLeads,
  getLeadById,
  getLeadByWhatsAppWaId,
  getWhatsAppLeadByPhone,
  getOpenLeadByPhone,
  getLeadByEmail,
  createLead,
  updateLead,
  addMessage,
  listMessages,
  getLastInboundAt,
  getLeadStats,
};
