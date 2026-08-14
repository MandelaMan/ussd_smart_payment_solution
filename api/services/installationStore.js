const { query } = require("../config/db");
const moment = require("moment-timezone");
const { DEFAULT_TZ } = require("../utils/billingPeriod");

const VALID_KINDS = new Set(["onboarding", "apartment_switch"]);
const VALID_MODES = new Set(["auto", "manual"]);
const VALID_STATUSES = new Set([
  "unassigned",
  "assigned",
  "in_progress",
  "completed",
  "cancelled",
]);
const OPEN_STATUSES = ["unassigned", "assigned", "in_progress"];

function wallClockFromMysql(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 19).replace("T", " ");
  }
  return String(value).slice(0, 19).replace("T", " ");
}

function formatInstallationDisplay(scheduledAt) {
  const wall = wallClockFromMysql(scheduledAt);
  const m = moment(wall, "YYYY-MM-DD HH:mm:ss", true);
  if (!m.isValid()) {
    return { date: "", time: "", dateTime: wall || "" };
  }
  return {
    date: m.format("D MMM YYYY"),
    time: m.format("h:mm A"),
    dateTime: m.format("D MMM YYYY [at] h:mm A"),
  };
}

function parseInstallationInput(body = {}, { required = false } = {}) {
  const date = String(body.installationDate || "").trim().slice(0, 10);
  const timeRaw = String(body.installationTime || "").trim();
  let scheduledAt = String(body.installationScheduledAt || "").trim();

  if (!scheduledAt && date && timeRaw) {
    const time = /^\d{2}:\d{2}$/.test(timeRaw) ? `${timeRaw}:00` : timeRaw;
    scheduledAt = `${date} ${time}`;
  }

  const mode = String(
    body.installationAssignmentMode || body.assignmentMode || "auto"
  )
    .trim()
    .toLowerCase();
  const assignmentMode = VALID_MODES.has(mode) ? mode : "auto";

  if (!scheduledAt) {
    if (date && !timeRaw) {
      throw new Error("Installation time is required when a date is set");
    }
    if (!date && timeRaw) {
      throw new Error("Installation date is required when a time is set");
    }
    if (required) {
      throw new Error("Installation date and time are required");
    }
    return { scheduledAt: null, assignmentMode };
  }

  scheduledAt = scheduledAt.replace("T", " ").slice(0, 19);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(scheduledAt)) {
    throw new Error("Invalid installation date and time");
  }
  if (scheduledAt.length === 16) scheduledAt = `${scheduledAt}:00`;

  const parsed = moment(scheduledAt, "YYYY-MM-DD HH:mm:ss", true);
  if (!parsed.isValid()) {
    throw new Error("Invalid installation date and time");
  }

  return { scheduledAt, assignmentMode };
}

function mapRow(row) {
  if (!row) return null;
  const scheduledAt = wallClockFromMysql(row.scheduled_at);
  const needsSchedule = !scheduledAt;
  const display = needsSchedule
    ? { date: "No date provided", time: "", dateTime: "No date provided" }
    : formatInstallationDisplay(scheduledAt);
  return {
    id: Number(row.id),
    customerId: Number(row.customer_id),
    customerNumber: row.customer_number || "",
    customerName: String(row.customer_name || "").trim(),
    buildingId: row.building_id != null ? Number(row.building_id) : null,
    buildingName: row.building_name || null,
    apartmentNumber: row.apartment_number || "",
    kind: row.kind,
    scheduledAt: scheduledAt || null,
    scheduledDate: scheduledAt ? scheduledAt.slice(0, 10) : "",
    scheduledTime: scheduledAt ? scheduledAt.slice(11, 16) : "",
    needsSchedule,
    displayDate: display.date,
    displayTime: display.time,
    displayDateTime: display.dateTime,
    durationMinutes: Number(row.duration_minutes || 120),
    assignmentMode: row.assignment_mode,
    technicianId: row.technician_id != null ? Number(row.technician_id) : null,
    technicianName: row.technician_name || null,
    technicianEmail: row.technician_email || null,
    status: row.status,
    notes: row.notes || null,
    createdBy: row.created_by != null ? Number(row.created_by) : null,
    assignedAt: wallClockFromMysql(row.assigned_at) || null,
    completedAt: wallClockFromMysql(row.completed_at) || null,
    createdAt: wallClockFromMysql(row.created_at) || null,
  };
}

const SELECT_SQL = `
  SELECT i.*,
         TRIM(CONCAT(c.first_name, ' ', COALESCE(c.middle_name, ''), ' ', c.last_name)) AS customer_name,
         b.name AS building_name,
         u.name AS technician_name,
         u.email AS technician_email
  FROM installations i
  LEFT JOIN customers c ON c.id = i.customer_id
  LEFT JOIN buildings b ON b.id = i.building_id
  LEFT JOIN admin_users u ON u.id = i.technician_id
`;

async function getInstallationById(id) {
  const rows = await query(`${SELECT_SQL} WHERE i.id = ? LIMIT 1`, [Number(id)]);
  return mapRow(rows[0]);
}

async function listTechnicians() {
  const rows = await query(
    `SELECT u.id, u.name, u.email, u.job_title
     FROM admin_users u
     WHERE u.is_active = 1
       AND (
         EXISTS (
           SELECT 1
           FROM rbac_user_groups ug
           JOIN rbac_groups g ON g.id = ug.group_id
           WHERE ug.user_id = u.id
             AND g.slug = 'technician'
             AND g.is_active = 1
         )
         OR LOWER(COALESCE(u.job_title, '')) LIKE '%technician%'
       )
     ORDER BY u.name ASC`
  );
  return (rows || []).map((u) => ({
    id: Number(u.id),
    name: u.name,
    email: u.email,
    jobTitle: u.job_title || null,
  }));
}

async function pickTechnicianForSlot(scheduledAt) {
  const day = String(scheduledAt).slice(0, 10);
  const technicians = await listTechnicians();
  if (!technicians.length) return null;

  const loads = await query(
    `SELECT technician_id, COUNT(*) AS job_count
     FROM installations
     WHERE technician_id IS NOT NULL
       AND status IN ('unassigned', 'assigned', 'in_progress')
       AND DATE(scheduled_at) = ?
     GROUP BY technician_id`,
    [day]
  );
  const loadById = new Map(
    (loads || []).map((r) => [Number(r.technician_id), Number(r.job_count || 0)])
  );

  technicians.sort((a, b) => {
    const byLoad = (loadById.get(a.id) || 0) - (loadById.get(b.id) || 0);
    if (byLoad) return byLoad;
    return String(a.name).localeCompare(String(b.name));
  });
  return technicians[0];
}

async function createInstallation({
  customerId,
  customerNumber,
  buildingId,
  apartmentNumber,
  kind,
  scheduledAt,
  assignmentMode = "auto",
  durationMinutes = 120,
  notes = null,
  createdBy = null,
}) {
  if (!VALID_KINDS.has(kind)) {
    throw new Error("Installation kind must be onboarding or apartment_switch");
  }
  const mode = VALID_MODES.has(assignmentMode) ? assignmentMode : "auto";
  let technicianId = null;
  let status = "unassigned";
  let assignedAt = null;

  if (mode === "auto" && scheduledAt) {
    const tech = await pickTechnicianForSlot(scheduledAt);
    if (tech) {
      technicianId = tech.id;
      status = "assigned";
      assignedAt = moment.tz(DEFAULT_TZ).format("YYYY-MM-DD HH:mm:ss");
    }
  }

  const result = await query(
    `INSERT INTO installations
       (customer_id, customer_number, building_id, apartment_number, kind,
        scheduled_at, duration_minutes, assignment_mode, technician_id, status,
        notes, created_by, assigned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(customerId),
      customerNumber || null,
      buildingId != null ? Number(buildingId) : null,
      apartmentNumber || null,
      kind,
      scheduledAt,
      Number(durationMinutes) || 120,
      mode,
      technicianId,
      status,
      notes || null,
      createdBy != null ? Number(createdBy) : null,
      assignedAt,
    ]
  );

  return getInstallationById(result.insertId);
}

async function listInstallations({
  status,
  kind,
  technicianId,
  q,
  from,
  to,
  page = 1,
  limit = 50,
} = {}) {
  const clauses = [];
  const params = [];
  if (String(status) === "unscheduled") {
    clauses.push("i.scheduled_at IS NULL");
  } else if (status && VALID_STATUSES.has(String(status))) {
    clauses.push("i.status = ?");
    params.push(status);
  }
  if (kind && VALID_KINDS.has(String(kind))) {
    clauses.push("i.kind = ?");
    params.push(kind);
  }
  if (technicianId === "unassigned") {
    clauses.push("i.technician_id IS NULL");
  } else if (technicianId && Number(technicianId) > 0) {
    clauses.push("i.technician_id = ?");
    params.push(Number(technicianId));
  }
  if (from) {
    clauses.push("i.scheduled_at >= ?");
    params.push(`${String(from).slice(0, 10)} 00:00:00`);
  }
  if (to) {
    clauses.push("i.scheduled_at <= ?");
    params.push(`${String(to).slice(0, 10)} 23:59:59`);
  }
  const search = String(q || "").trim();
  if (search) {
    clauses.push(
      `(i.customer_number LIKE ? OR i.apartment_number LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR b.name LIKE ?)`
    );
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(limit) || 50));
  const offset = (pageNum - 1) * pageSize;

  const [countRows, rows] = await Promise.all([
    query(
      `SELECT COUNT(*) AS total
       FROM installations i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN buildings b ON b.id = i.building_id
       ${where}`,
      params
    ),
    query(
      `${SELECT_SQL} ${where}
       ORDER BY i.scheduled_at IS NULL DESC, i.scheduled_at ASC, i.id ASC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    ),
  ]);

  const total = Number(countRows[0]?.total || 0);
  return {
    data: (rows || []).map(mapRow),
    pagination: {
      page: pageNum,
      limit: pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

async function assignTechnician(id, technicianId) {
  const existing = await getInstallationById(id);
  if (!existing) throw new Error("Installation not found");
  if (existing.status === "cancelled" || existing.status === "completed") {
    throw new Error("Cannot assign a completed or cancelled installation");
  }

  let nextTech = null;
  if (technicianId != null && Number(technicianId) > 0) {
    const techs = await listTechnicians();
    nextTech = techs.find((t) => t.id === Number(technicianId)) || null;
    if (!nextTech) {
      const rows = await query(
        `SELECT id, name, email FROM admin_users WHERE id = ? AND is_active = 1 LIMIT 1`,
        [Number(technicianId)]
      );
      if (!rows[0]) throw new Error("Technician not found");
      nextTech = {
        id: Number(rows[0].id),
        name: rows[0].name,
        email: rows[0].email,
      };
    }
  }

  const assignedAt = nextTech
    ? moment.tz(DEFAULT_TZ).format("YYYY-MM-DD HH:mm:ss")
    : null;
  const status = nextTech
    ? existing.status === "unassigned"
      ? "assigned"
      : existing.status
    : "unassigned";

  await query(
    `UPDATE installations
     SET technician_id = ?, status = ?, assigned_at = ?
     WHERE id = ?`,
    [nextTech ? nextTech.id : null, status, assignedAt, Number(id)]
  );

  return getInstallationById(id);
}

async function updateInstallation(id, patch = {}) {
  const existing = await getInstallationById(id);
  if (!existing) throw new Error("Installation not found");

  const updates = [];
  const params = [];

  if (patch.status != null) {
    const status = String(patch.status).toLowerCase();
    if (!VALID_STATUSES.has(status)) throw new Error("Invalid installation status");
    updates.push("status = ?");
    params.push(status);
    if (status === "completed") {
      updates.push("completed_at = ?");
      params.push(moment.tz(DEFAULT_TZ).format("YYYY-MM-DD HH:mm:ss"));
    }
    if (status === "unassigned") {
      updates.push("technician_id = NULL");
      updates.push("assigned_at = NULL");
    }
  }
  if (patch.scheduledAt) {
    const parsed = parseInstallationInput(
      { installationScheduledAt: patch.scheduledAt },
      { required: true }
    );
    updates.push("scheduled_at = ?");
    params.push(parsed.scheduledAt);
    if (
      existing.assignmentMode === "auto" &&
      !existing.technicianId &&
      existing.status === "unassigned"
    ) {
      const tech = await pickTechnicianForSlot(parsed.scheduledAt);
      if (tech) {
        updates.push("technician_id = ?");
        params.push(tech.id);
        updates.push("status = ?");
        params.push("assigned");
        updates.push("assigned_at = ?");
        params.push(moment.tz(DEFAULT_TZ).format("YYYY-MM-DD HH:mm:ss"));
      }
    }
  }
  if (patch.notes !== undefined) {
    updates.push("notes = ?");
    params.push(patch.notes ? String(patch.notes) : null);
  }

  if (!updates.length) return existing;
  params.push(Number(id));
  await query(`UPDATE installations SET ${updates.join(", ")} WHERE id = ?`, params);
  return getInstallationById(id);
}

function emailVarsFromInstallation(installation) {
  if (!installation || installation.needsSchedule || !installation.scheduledAt) {
    return {
      installationDate: "",
      installationTime: "",
      installationDateTime: "",
      technicianName: "",
    };
  }
  return {
    installationDate: installation.displayDate || "",
    installationTime: installation.displayTime || "",
    installationDateTime: installation.displayDateTime || "",
    technicianName: installation.technicianName || "",
  };
}

async function scheduleCustomerInstallation(customer, body, { kind, createdBy, notes } = {}) {
  const parsed = parseInstallationInput(body);
  const missingSlot = !parsed.scheduledAt;
  return createInstallation({
    customerId: customer.id || customer.customerId,
    customerNumber: customer.customerNumber || customer.customer_number,
    buildingId: customer.buildingId || customer.building_id,
    apartmentNumber: customer.apartmentNumber || customer.apartment_number,
    kind,
    scheduledAt: parsed.scheduledAt,
    assignmentMode: parsed.assignmentMode,
    createdBy,
    notes:
      notes ||
      (missingSlot ? "Customer created without an installation date" : null),
  });
}

module.exports = {
  OPEN_STATUSES,
  parseInstallationInput,
  formatInstallationDisplay,
  createInstallation,
  getInstallationById,
  listInstallations,
  listTechnicians,
  assignTechnician,
  updateInstallation,
  emailVarsFromInstallation,
  scheduleCustomerInstallation,
};
