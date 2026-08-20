const { getPool, query } = require("../config/db");
const { emitAdminUpdate } = require("../lib/adminEvents");
const { logActivity } = require("./activityLogStore");
const notificationStore = require("./notificationStore");

const VALID_STATUSES = new Set(["open", "in_progress", "completed", "cancelled"]);
const VALID_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const VALID_STEP_STATUSES = new Set(["pending", "done", "skipped"]);
const OPEN_STATUSES = ["open", "in_progress"];

function wallClock(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 19).replace("T", " ");
  }
  return String(value).slice(0, 19).replace("T", " ") || null;
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function uniqueIds(list) {
  return [...new Set((list || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
}

function pendingChecklistCount(item) {
  return (item?.steps || []).filter((step) => step.status === "pending").length;
}

function assertCanComplete(item) {
  const pending = pendingChecklistCount(item);
  if (pending <= 0) return;
  throw new Error(
    pending === 1
      ? "Finish the remaining checklist item before marking this complete"
      : `Finish the remaining ${pending} checklist items before marking this complete`
  );
}

function parseJson(value, fallback = {}) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function actorFields(actor) {
  const id = actor?.id != null ? Number(actor.id) : null;
  const name = actor?.name ? String(actor.name).trim().slice(0, 191) : null;
  return {
    actorId: Number.isFinite(id) && id > 0 ? id : null,
    actorName: name || null,
  };
}

function statusPhrase(status) {
  if (status === "in_progress") return "in progress";
  return String(status || "").replace(/_/g, " ");
}

function quoteLabel(label) {
  return `“${String(label || "").trim()}”`;
}

function truncateDetail(text, max = 240) {
  const value = String(text || "").trim();
  if (!value) return null;
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function mapEvent(row) {
  if (!row) return null;
  const metadata = parseJson(row.metadata, {});
  return {
    id: Number(row.id),
    type: row.event_type,
    message: row.message,
    detail: row.detail || null,
    actorUserId: row.actor_user_id != null ? Number(row.actor_user_id) : null,
    actorName: row.actor_name || null,
    createdAt: wallClock(row.created_at),
    metadata,
  };
}

function stepEventMessage(status, label) {
  if (status === "done") return `Completed ${quoteLabel(label)}`;
  if (status === "skipped") return `Skipped ${quoteLabel(label)}`;
  return `Reopened ${quoteLabel(label)}`;
}

function synthesizeActionItemHistory(item) {
  const events = [];
  if (item?.createdAt) {
    events.push({
      id: "created",
      type: "created",
      message: "Created this reminder",
      detail: null,
      actorUserId: item.createdBy,
      actorName: item.createdByName || null,
      createdAt: item.createdAt,
      metadata: {},
    });
  }
  for (const step of item?.steps || []) {
    if (!step.completedAt) continue;
    if (step.status !== "done" && step.status !== "skipped") continue;
    events.push({
      id: `step-${step.id}`,
      type: step.status === "skipped" ? "step_skipped" : "step_done",
      message: stepEventMessage(step.status, step.label),
      detail: null,
      actorUserId: step.completedBy,
      actorName: step.completedByName || null,
      createdAt: step.completedAt,
      metadata: { stepId: step.id },
    });
  }
  if (item?.status === "completed" && item.completedAt) {
    events.push({
      id: "completed",
      type: "status_changed",
      message: "Marked completed",
      detail: null,
      actorUserId: item.completedBy,
      actorName: item.completedByName || null,
      createdAt: item.completedAt,
      metadata: { status: "completed" },
    });
  }
  return events;
}

function mergeActionItemHistory(item, stored = []) {
  const logged = Array.isArray(stored) ? stored.filter(Boolean) : [];
  const hasCreated = logged.some((event) => event.type === "created");
  const loggedStepIds = new Set(
    logged
      .map((event) => Number(event.metadata?.stepId))
      .filter((id) => Number.isFinite(id) && id > 0)
  );
  const hasCompleted = logged.some(
    (event) => event.type === "status_changed" && event.metadata?.status === "completed"
  );

  const extra = synthesizeActionItemHistory(item).filter((event) => {
    if (event.type === "created") return !hasCreated;
    if (event.type === "step_done" || event.type === "step_skipped") {
      return !loggedStepIds.has(Number(event.metadata?.stepId));
    }
    if (event.id === "completed") return !hasCompleted;
    return true;
  });

  return [...logged, ...extra].sort((a, b) => {
    const byTime = String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    if (byTime) return byTime;
    return String(b.id).localeCompare(String(a.id), undefined, { numeric: true });
  });
}

/** Tagged users always get assignment pings, including the person who created the reminder. */
function notificationRecipientIds(userIds, { type, actorId } = {}) {
  const ids = uniqueIds(userIds);
  if (type === "action_completed" && actorId != null && Number(actorId) > 0) {
    return ids.filter((id) => id !== Number(actorId));
  }
  return ids;
}

function formatDueDisplay(dueDate) {
  const d = dateOnly(dueDate);
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function mapStep(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    actionItemId: Number(row.action_item_id),
    stepKey: row.step_key,
    label: row.label,
    description: row.description || "",
    sortOrder: Number(row.sort_order || 0),
    status: row.status,
    assignedTo: row.assigned_to != null ? Number(row.assigned_to) : null,
    assignedToName: row.assigned_to_name || null,
    completedAt: wallClock(row.completed_at),
    completedBy: row.completed_by != null ? Number(row.completed_by) : null,
    completedByName: row.completed_by_name || null,
    notes: row.notes || null,
  };
}

function mapAssignee(row) {
  return {
    id: Number(row.user_id),
    name: row.name || "",
    email: row.email || "",
    jobTitle: row.job_title || null,
  };
}

function mapType(row, steps = []) {
  return {
    id: Number(row.id),
    key: row.type_key,
    name: row.name,
    description: row.description || "",
    requiresCustomer: Boolean(row.requires_customer),
    notifyCustomer: Boolean(row.notify_customer),
    sortOrder: Number(row.sort_order || 0),
    steps: steps.map((s) => ({
      key: s.step_key,
      label: s.label,
      description: s.description || "",
      sortOrder: Number(s.sort_order || 0),
    })),
  };
}

function mapItem(row, extras = {}) {
  if (!row) return null;
  const dueDate = dateOnly(row.due_date);
  const stepCount = Number(row.step_count || extras.steps?.length || 0);
  const stepsDone = Number(row.steps_done || 0);
  return {
    id: Number(row.id),
    typeId: Number(row.action_type_id),
    typeKey: row.type_key,
    typeName: row.type_name,
    title: row.title,
    description: row.description || "",
    customerId: row.customer_id != null ? Number(row.customer_id) : null,
    customerNumber: row.customer_number || "",
    customerName: String(row.customer_name || "").trim(),
    buildingName: row.building_name || null,
    apartmentNumber: row.apartment_number || "",
    dueDate,
    dueDisplay: formatDueDisplay(dueDate),
    priority: row.priority,
    status: row.status,
    createdBy: row.created_by != null ? Number(row.created_by) : null,
    createdByName: row.created_by_name || null,
    completedAt: wallClock(row.completed_at),
    completedBy: row.completed_by != null ? Number(row.completed_by) : null,
    completedByName: row.completed_by_name || null,
    notes: row.notes || "",
    stepCount,
    stepsDone,
    assigneeNames: row.assignee_names || "",
    createdAt: wallClock(row.created_at),
    updatedAt: wallClock(row.updated_at),
    steps: extras.steps || undefined,
    assignees: extras.assignees || undefined,
  };
}

const SELECT_SQL = `
  SELECT ai.*,
         at.type_key,
         at.name AS type_name,
         at.requires_customer,
         at.notify_customer,
         TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.middle_name, ''), ' ', COALESCE(c.last_name, ''))) AS customer_name,
         c.customer_number,
         c.apartment_number,
         b.name AS building_name,
         creator.name AS created_by_name,
         completer.name AS completed_by_name,
         (SELECT COUNT(*) FROM action_item_steps s WHERE s.action_item_id = ai.id) AS step_count,
         (SELECT COUNT(*) FROM action_item_steps s WHERE s.action_item_id = ai.id AND s.status = 'done') AS steps_done,
         (SELECT GROUP_CONCAT(u.name ORDER BY u.name SEPARATOR ', ')
            FROM action_item_assignees aia
            JOIN admin_users u ON u.id = aia.user_id
           WHERE aia.action_item_id = ai.id) AS assignee_names
    FROM action_items ai
    JOIN action_types at ON at.id = ai.action_type_id
    LEFT JOIN customers c ON c.id = ai.customer_id
    LEFT JOIN buildings b ON b.id = c.building_id
    LEFT JOIN admin_users creator ON creator.id = ai.created_by
    LEFT JOIN admin_users completer ON completer.id = ai.completed_by
`;

async function listTypes() {
  const types = await query(
    `SELECT * FROM action_types WHERE is_active = 1 ORDER BY sort_order ASC, id ASC`
  );
  if (!types.length) return [];
  const ids = types.map((t) => t.id);
  const steps = await query(
    `SELECT * FROM action_type_steps
     WHERE action_type_id IN (${ids.map(() => "?").join(",")})
     ORDER BY sort_order ASC, id ASC`,
    ids
  );
  const byType = new Map();
  for (const step of steps) {
    const list = byType.get(step.action_type_id) || [];
    list.push(step);
    byType.set(step.action_type_id, list);
  }
  return types.map((t) => mapType(t, byType.get(t.id) || []));
}

async function getTypeByKey(typeKey) {
  const rows = await query(
    `SELECT * FROM action_types WHERE type_key = ? AND is_active = 1 LIMIT 1`,
    [String(typeKey || "").trim()]
  );
  if (!rows[0]) return null;
  const steps = await query(
    `SELECT * FROM action_type_steps WHERE action_type_id = ? ORDER BY sort_order ASC, id ASC`,
    [rows[0].id]
  );
  return mapType(rows[0], steps);
}

async function listAssignableUsers() {
  const rows = await query(
    `SELECT id, name, email, job_title, role
     FROM admin_users
     WHERE is_active = 1
     ORDER BY name ASC`
  );
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    email: row.email,
    jobTitle: row.job_title || null,
    role: row.role || "user",
  }));
}

async function loadAssignees(itemId) {
  const rows = await query(
    `SELECT aia.user_id, u.name, u.email, u.job_title
     FROM action_item_assignees aia
     JOIN admin_users u ON u.id = aia.user_id
     WHERE aia.action_item_id = ?
     ORDER BY u.name ASC`,
    [Number(itemId)]
  );
  return rows.map(mapAssignee);
}

async function loadSteps(itemId) {
  const rows = await query(
    `SELECT s.*,
            au.name AS assigned_to_name,
            cu.name AS completed_by_name
     FROM action_item_steps s
     LEFT JOIN admin_users au ON au.id = s.assigned_to
     LEFT JOIN admin_users cu ON cu.id = s.completed_by
     WHERE s.action_item_id = ?
     ORDER BY s.sort_order ASC, s.id ASC`,
    [Number(itemId)]
  );
  return rows.map(mapStep);
}

async function recordEvent(itemId, { type, message, detail = null, metadata = {}, actor } = {}) {
  const { actorId, actorName } = actorFields(actor);
  try {
    await query(
      `INSERT INTO action_item_events
         (action_item_id, event_type, message, detail, metadata, actor_user_id, actor_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(itemId),
        String(type || "updated").slice(0, 64),
        String(message || "Updated this reminder").slice(0, 500),
        detail ? String(detail) : null,
        JSON.stringify(metadata || {}),
        actorId,
        actorName,
      ]
    );
  } catch (err) {
    console.warn("action item event log failed:", err?.message || err);
  }
}

async function loadStoredEvents(itemId) {
  try {
    const rows = await query(
      `SELECT id, event_type, message, detail, metadata, actor_user_id, actor_name, created_at
         FROM action_item_events
        WHERE action_item_id = ?
        ORDER BY created_at DESC, id DESC`,
      [Number(itemId)]
    );
    return rows.map(mapEvent);
  } catch (err) {
    console.warn("action item history load failed:", err?.message || err);
    return [];
  }
}

async function getById(id) {
  const rows = await query(`${SELECT_SQL} WHERE ai.id = ? LIMIT 1`, [Number(id)]);
  if (!rows[0]) return null;
  const [steps, assignees, storedEvents] = await Promise.all([
    loadSteps(id),
    loadAssignees(id),
    loadStoredEvents(id),
  ]);
  const item = mapItem(rows[0], { steps, assignees });
  item.history = mergeActionItemHistory(item, storedEvents);
  return item;
}

async function listActionItems({
  status,
  typeKey,
  customerId,
  assignedTo,
  mineUserId,
  q,
  from,
  to,
  overdue,
  page = 1,
  limit = 40,
} = {}) {
  const clauses = ["1=1"];
  const params = [];

  if (status === "open_any") {
    clauses.push(`ai.status IN (${OPEN_STATUSES.map(() => "?").join(",")})`);
    params.push(...OPEN_STATUSES);
  } else if (status && VALID_STATUSES.has(status)) {
    clauses.push("ai.status = ?");
    params.push(status);
  }

  if (typeKey) {
    clauses.push("at.type_key = ?");
    params.push(String(typeKey));
  }
  if (customerId) {
    clauses.push("ai.customer_id = ?");
    params.push(Number(customerId));
  }

  const assigneeId = assignedTo || mineUserId;
  if (assigneeId) {
    clauses.push(
      `EXISTS (
         SELECT 1 FROM action_item_assignees aia
         WHERE aia.action_item_id = ai.id AND aia.user_id = ?
       )`
    );
    params.push(Number(assigneeId));
  }

  const search = String(q || "").trim();
  if (search) {
    const like = `%${search}%`;
    clauses.push(
      `(ai.title LIKE ? OR c.customer_number LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.apartment_number LIKE ?)`
    );
    params.push(like, like, like, like, like);
  }

  if (from) {
    clauses.push("ai.due_date >= ?");
    params.push(dateOnly(from));
  }
  if (to) {
    clauses.push("ai.due_date <= ?");
    params.push(dateOnly(to));
  }
  if (overdue === true || overdue === "1" || overdue === "true") {
    clauses.push("ai.due_date IS NOT NULL AND ai.due_date < CURDATE()");
    clauses.push(`ai.status IN (${OPEN_STATUSES.map(() => "?").join(",")})`);
    params.push(...OPEN_STATUSES);
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const take = Math.min(100, Math.max(1, Number(limit) || 40));
  const offset = (pageNum - 1) * take;
  const where = clauses.join(" AND ");

  const countRows = await query(
    `SELECT COUNT(*) AS n
     FROM action_items ai
     JOIN action_types at ON at.id = ai.action_type_id
     LEFT JOIN customers c ON c.id = ai.customer_id
     WHERE ${where}`,
    params
  );
  const total = Number(countRows[0]?.n || 0);
  const rows = await query(
    `${SELECT_SQL}
     WHERE ${where}
     ORDER BY
       CASE ai.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
       CASE WHEN ai.due_date IS NULL THEN 1 ELSE 0 END,
       ai.due_date ASC,
       ai.id DESC
     LIMIT ${take} OFFSET ${offset}`,
    params
  );

  return {
    data: rows.map((row) => mapItem(row)),
    pagination: {
      page: pageNum,
      limit: take,
      total,
      pages: Math.max(1, Math.ceil(total / take)),
    },
  };
}

async function assertActiveUsers(ids) {
  const unique = uniqueIds(ids);
  if (!unique.length) return [];
  const rows = await query(
    `SELECT id FROM admin_users WHERE is_active = 1 AND id IN (${unique.map(() => "?").join(",")})`,
    unique
  );
  const found = new Set(rows.map((r) => Number(r.id)));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length) {
    throw new Error("One or more tagged users are invalid or inactive");
  }
  return unique;
}

function normalizeExtraSteps(extraSteps) {
  if (!Array.isArray(extraSteps)) return [];
  return extraSteps
    .map((step, index) => {
      const label = String(step?.label || step || "").trim();
      if (!label) return null;
      return {
        key: String(step?.key || `custom_${index + 1}`).slice(0, 64),
        label: label.slice(0, 200),
        description: String(step?.description || "").trim().slice(0, 500),
      };
    })
    .filter(Boolean);
}

async function insertAssignees(conn, itemId, userIds) {
  for (const userId of userIds) {
    await conn.query(
      `INSERT INTO action_item_assignees (action_item_id, user_id) VALUES (?, ?)`,
      [itemId, userId]
    );
  }
}

async function insertSteps(conn, itemId, steps) {
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    await conn.query(
      `INSERT INTO action_item_steps
         (action_item_id, step_key, label, description, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
      [
        itemId,
        String(step.key || `step_${i + 1}`).slice(0, 64),
        String(step.label).slice(0, 200),
        step.description ? String(step.description).slice(0, 500) : null,
        (i + 1) * 10,
      ]
    );
  }
}

async function createActionItem(body, { actor } = {}) {
  const type = await getTypeByKey(body.typeKey);
  if (!type) throw new Error("Unknown action type");

  const customerId =
    body.customerId === null || body.customerId === "" || body.customerId === undefined
      ? null
      : Number(body.customerId);
  if (type.requiresCustomer && !customerId) {
    throw new Error("This reminder requires a customer");
  }

  let customer = null;
  if (customerId) {
    const customerStore = require("./customerModuleStore");
    customer = await customerStore.getCustomerById(customerId);
    if (!customer) throw new Error("Customer not found");
  }

  const assigneeIds = await assertActiveUsers(body.assigneeIds || body.taggedUserIds);
  const extraSteps = normalizeExtraSteps(body.extraSteps);
  const steps = [
    ...type.steps.map((s) => ({ key: s.key, label: s.label, description: s.description })),
    ...extraSteps,
  ];
  if (type.key === "custom" && !steps.length) {
    throw new Error("Add at least one checklist item for a custom reminder");
  }

  const title =
    String(body.title || "").trim() ||
    (customer
      ? `${type.name} — ${customer.customerNumber || customer.fullName}`
      : type.name);
  const description = String(body.description || "").trim() || null;
  const notes = String(body.notes || "").trim() || null;
  const dueDate = dateOnly(body.dueDate);
  const priority = VALID_PRIORITIES.has(body.priority) ? body.priority : "normal";
  const actorId = actor?.id != null ? Number(actor.id) : null;

  const pool = getPool();
  const conn = await pool.getConnection();
  let itemId;
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO action_items
         (action_type_id, title, description, customer_id, due_date, priority, status, created_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      [type.id, title.slice(0, 255), description, customerId, dueDate, priority, actorId, notes]
    );
    itemId = Number(result.insertId);
    await insertSteps(conn, itemId, steps);
    await insertAssignees(conn, itemId, assigneeIds);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await recordEvent(itemId, {
    type: "created",
    message: "Created this reminder",
    actor,
    metadata: {},
  });

  const item = await getById(itemId);
  const notifyCustomer = Boolean(item.customerId) && body.notifyCustomer === true;

  try {
    await notifyAssignees(item, {
      type: "action_assigned",
      title: `Reminder: ${item.title}`,
      body: item.customerNumber
        ? `${item.typeName} for ${item.customerNumber}${item.dueDisplay ? ` · due ${item.dueDisplay}` : ""}`
        : `${item.typeName}${item.dueDisplay ? ` · due ${item.dueDisplay}` : ""}`,
      actorId,
      onlyUserIds: assigneeIds,
    });
  } catch (err) {
    console.error("action item notify failed:", err?.message || err);
  }

  if (notifyCustomer) {
    await notifyCustomerOfAction(item, "action_opened", actorId).catch((err) =>
      console.warn("action customer email failed:", err?.message || err)
    );
  }

  await logActivity({
    eventType: "action_item_created",
    title: "Reminder created",
    message: item.customerNumber
      ? `${item.typeName}: ${item.customerNumber}`
      : item.title,
    source: "admin",
    status: "success",
    customerRef: item.customerNumber || null,
    metadata: { actionItemId: item.id, typeKey: item.typeKey },
    actor,
  }).catch(() => {});

  emitAdminUpdate("action_items", { action: "created", id: item.id });
  return item;
}

async function namesForIds(ids) {
  const unique = uniqueIds(ids);
  if (!unique.length) return [];
  const rows = await query(
    `SELECT id, name FROM admin_users WHERE id IN (${unique.map(() => "?").join(",")})`,
    unique
  );
  const byId = new Map(rows.map((row) => [Number(row.id), row.name]));
  return unique.map((id) => byId.get(id)).filter(Boolean);
}

async function replaceAssignees(itemId, userIds, { actor } = {}) {
  const item = await getById(itemId);
  if (!item) throw new Error("Reminder not found");
  const nextIds = await assertActiveUsers(userIds);
  const previousAssignees = item.assignees || [];
  const previous = new Set(previousAssignees.map((a) => a.id));
  const added = nextIds.filter((id) => !previous.has(id));
  const removed = previousAssignees.filter((a) => !nextIds.includes(a.id));

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM action_item_assignees WHERE action_item_id = ?`, [item.id]);
    await insertAssignees(conn, item.id, nextIds);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  if (added.length || removed.length) {
    const addedNames = await namesForIds(added);
    const removedNames = removed.map((a) => a.name).filter(Boolean);
    let message = "Updated tagged users";
    if (addedNames.length && !removedNames.length) {
      message = `Tagged ${addedNames.join(", ")}`;
    } else if (removedNames.length && !addedNames.length) {
      message = `Removed ${removedNames.join(", ")}`;
    }
    const detailParts = [];
    if (addedNames.length && removedNames.length) {
      detailParts.push(`Added ${addedNames.join(", ")}`);
      detailParts.push(`Removed ${removedNames.join(", ")}`);
    }
    await recordEvent(item.id, {
      type: "assignees_updated",
      message,
      detail: detailParts.length ? detailParts.join(". ") : null,
      actor,
      metadata: { addedUserIds: added, removedUserIds: removed.map((a) => a.id) },
    });
  }

  const updated = await getById(item.id);
  if (added.length) {
    try {
      await notifyAssignees(updated, {
        type: "action_assigned",
        title: `Assigned: ${updated.title}`,
        body: updated.customerNumber
          ? `${updated.typeName} for ${updated.customerNumber}`
          : updated.typeName,
        actorId: actor?.id,
        onlyUserIds: added,
      });
    } catch (err) {
      console.error("action item reassign notify failed:", err?.message || err);
    }
  }
  emitAdminUpdate("action_items", { action: "assigned", id: updated.id });
  return updated;
}

async function updateActionItem(id, patch, { actor } = {}) {
  const item = await getById(id);
  if (!item) throw new Error("Reminder not found");

  const updates = [];
  const params = [];
  const historyEvents = [];

  if (patch.title != null) {
    const title = String(patch.title).trim();
    if (!title) throw new Error("Title is required");
    if (title !== item.title) {
      updates.push("title = ?");
      params.push(title.slice(0, 255));
      historyEvents.push({
        type: "title_changed",
        message: `Renamed to ${quoteLabel(title.slice(0, 200))}`,
      });
    }
  }
  if (patch.description !== undefined) {
    const description = String(patch.description || "").trim() || null;
    if (description !== (item.description || null)) {
      updates.push("description = ?");
      params.push(description);
      historyEvents.push({
        type: "description_changed",
        message: "Updated the description",
        detail: truncateDetail(description),
      });
    }
  }
  if (patch.notes !== undefined) {
    const notes = String(patch.notes || "").trim() || null;
    if ((notes || "") !== (item.notes || "")) {
      updates.push("notes = ?");
      params.push(notes);
      historyEvents.push({
        type: "notes_updated",
        message: "Updated internal notes",
        detail: truncateDetail(notes),
      });
    }
  }
  if (patch.dueDate !== undefined) {
    const dueDate = dateOnly(patch.dueDate);
    if (dueDate !== item.dueDate) {
      updates.push("due_date = ?");
      params.push(dueDate);
      historyEvents.push({
        type: "due_date_changed",
        message: dueDate ? `Changed due date to ${formatDueDisplay(dueDate)}` : "Cleared the due date",
      });
    }
  }
  if (patch.priority != null) {
    if (!VALID_PRIORITIES.has(patch.priority)) throw new Error("Invalid priority");
    if (patch.priority !== item.priority) {
      updates.push("priority = ?");
      params.push(patch.priority);
      historyEvents.push({
        type: "priority_changed",
        message: `Changed priority to ${patch.priority}`,
      });
    }
  }

  let statusChanged = false;
  let nextStatus = item.status;
  if (patch.status != null) {
    if (!VALID_STATUSES.has(patch.status)) throw new Error("Invalid status");
    nextStatus = patch.status;
    statusChanged = patch.status !== item.status;
    if (statusChanged && patch.status === "completed") {
      assertCanComplete(item);
    }
    if (statusChanged) {
      updates.push("status = ?");
      params.push(patch.status);
      historyEvents.push({
        type: "status_changed",
        message: `Marked ${statusPhrase(patch.status)}`,
        metadata: { status: patch.status },
      });
      if (patch.status === "completed") {
        updates.push("completed_at = COALESCE(completed_at, NOW())");
        updates.push("completed_by = COALESCE(completed_by, ?)");
        params.push(actor?.id != null ? Number(actor.id) : null);
      } else if (item.status === "completed") {
        updates.push("completed_at = NULL");
        updates.push("completed_by = NULL");
      }
    }
  }

  if (!updates.length && patch.assigneeIds == null) {
    return item;
  }

  if (updates.length) {
    params.push(item.id);
    await query(`UPDATE action_items SET ${updates.join(", ")} WHERE id = ?`, params);
    for (const event of historyEvents) {
      await recordEvent(item.id, { ...event, actor });
    }
  }

  let updated = await getById(item.id);
  if (Array.isArray(patch.assigneeIds)) {
    updated = await replaceAssignees(item.id, patch.assigneeIds, { actor });
  }

  if (statusChanged && nextStatus === "completed" && updated.customerId) {
    await notifyCustomerOfAction(updated, "action_completed", actor?.id).catch((err) =>
      console.warn("action completed email failed:", err?.message || err)
    );
    try {
      await notifyAssignees(updated, {
        type: "action_completed",
        title: `Completed: ${updated.title}`,
        body: updated.customerNumber
          ? `${updated.typeName} for ${updated.customerNumber}`
          : updated.typeName,
        actorId: actor?.id,
      });
    } catch (err) {
      console.error("action item completed notify failed:", err?.message || err);
    }
  }

  await logActivity({
    eventType: "action_item_updated",
    title: "Reminder updated",
    message: `${updated.title}${statusChanged ? ` → ${nextStatus}` : ""}`,
    source: "admin",
    status: "success",
    customerRef: updated.customerNumber || null,
    metadata: { actionItemId: updated.id, status: updated.status },
    actor,
  }).catch(() => {});

  emitAdminUpdate("action_items", { action: "updated", id: updated.id, status: updated.status });
  return updated;
}

async function updateStep(itemId, stepId, patch, { actor } = {}) {
  const item = await getById(itemId);
  if (!item) throw new Error("Reminder not found");
  const step = (item.steps || []).find((s) => s.id === Number(stepId));
  if (!step) throw new Error("Checklist item not found");

  const updates = [];
  const params = [];
  if (patch.status != null) {
    if (!VALID_STEP_STATUSES.has(patch.status)) throw new Error("Invalid step status");
    updates.push("status = ?");
    params.push(patch.status);
    if (patch.status === "done" || patch.status === "skipped") {
      updates.push("completed_at = NOW()");
      updates.push("completed_by = ?");
      params.push(actor?.id != null ? Number(actor.id) : null);
    } else {
      updates.push("completed_at = NULL");
      updates.push("completed_by = NULL");
    }
  }
  if (patch.notes !== undefined) {
    updates.push("notes = ?");
    params.push(String(patch.notes || "").trim() || null);
  }
  if (!updates.length) return item;

  params.push(Number(stepId), Number(itemId));
  await query(
    `UPDATE action_item_steps SET ${updates.join(", ")} WHERE id = ? AND action_item_id = ?`,
    params
  );

  if (patch.status != null && patch.status !== step.status) {
    const eventType =
      patch.status === "done" ? "step_done" : patch.status === "skipped" ? "step_skipped" : "step_undone";
    await recordEvent(itemId, {
      type: eventType,
      message: stepEventMessage(patch.status, step.label),
      actor,
      metadata: { stepId: step.id, status: patch.status },
    });
  }

  const steps = await loadSteps(itemId);
  const allDone = steps.length > 0 && steps.every((s) => s.status === "done" || s.status === "skipped");
  const anyStarted = steps.some((s) => s.status !== "pending");

  if (item.status !== "cancelled" && item.status !== "completed") {
    if (allDone) {
      await updateActionItem(itemId, { status: "completed" }, { actor });
    } else if (anyStarted && item.status === "open") {
      await query(`UPDATE action_items SET status = 'in_progress' WHERE id = ?`, [itemId]);
      await recordEvent(itemId, {
        type: "status_changed",
        message: "Marked in progress",
        actor,
        metadata: { status: "in_progress" },
      });
    }
  }

  emitAdminUpdate("action_items", { action: "step_updated", id: Number(itemId) });
  return getById(itemId);
}

async function addStep(itemId, { label, description } = {}, { actor } = {}) {
  const item = await getById(itemId);
  if (!item) throw new Error("Reminder not found");
  const text = String(label || "").trim();
  if (!text) throw new Error("Checklist item label is required");
  const maxOrder = (item.steps || []).reduce((m, s) => Math.max(m, s.sortOrder), 0);
  await query(
    `INSERT INTO action_item_steps (action_item_id, step_key, label, description, sort_order)
     VALUES (?, ?, ?, ?, ?)`,
    [
      item.id,
      `extra_${Date.now()}`.slice(0, 64),
      text.slice(0, 200),
      description ? String(description).trim().slice(0, 500) : null,
      maxOrder + 10,
    ]
  );
  await recordEvent(item.id, {
    type: "step_added",
    message: `Added checklist item ${quoteLabel(text)}`,
    actor,
    metadata: {},
  });
  emitAdminUpdate("action_items", { action: "step_added", id: item.id });
  return getById(item.id);
}

function checklistSummary(item) {
  const steps = item.steps || [];
  if (!steps.length) return "";
  const lines = steps.map((s) => `• ${s.label}`).join("<br/>");
  return `<strong>We'll complete:</strong><br/>${lines}`;
}

async function notifyAssignees(item, { type, title, body, actorId, onlyUserIds } = {}) {
  const sourceIds = onlyUserIds || (item.assignees || []).map((a) => a.id);
  const filtered = notificationRecipientIds(sourceIds, { type, actorId });
  if (!filtered.length) return;
  await notificationStore.createNotifications({
    userIds: filtered,
    type,
    title,
    body,
    actionItemId: item.id,
    push: { title, body, url: `/admin/reminders?id=${item.id}` },
  });
}

async function notifyCustomerOfAction(item, templateKey, actorId) {
  if (!item.customerId) return { skipped: true };

  const customerStore = require("./customerModuleStore");
  const customer = await customerStore.getCustomerById(item.customerId);
  if (!customer) return { skipped: true };

  const { sendCustomerLifecycleEmail } = require("./customerWelcomeEmail");
  const result = await sendCustomerLifecycleEmail(templateKey, customer, {
    createdBy: actorId || null,
    extraVars: {
      actionTitle: item.title,
      actionTypeName: item.typeName,
      dueDate: item.dueDisplay || "to be confirmed",
      assignedStaff: item.assigneeNames || "",
      actionNotes: item.description || item.notes || "",
      checklistSummary: checklistSummary(item),
    },
  });

  if (result?.ok) {
    const column =
      templateKey === "action_completed"
        ? "customer_completed_notified_at"
        : "customer_notified_at";
    await query(`UPDATE action_items SET ${column} = NOW() WHERE id = ?`, [item.id]);
  }
  return result;
}

module.exports = {
  VALID_STATUSES,
  VALID_PRIORITIES,
  listTypes,
  listAssignableUsers,
  listActionItems,
  getById,
  createActionItem,
  updateActionItem,
  replaceAssignees,
  updateStep,
  addStep,
  formatDueDisplay,
  notificationRecipientIds,
  mergeActionItemHistory,
  synthesizeActionItemHistory,
  pendingChecklistCount,
  assertCanComplete,
};
