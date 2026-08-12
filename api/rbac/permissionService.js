const { query } = require("../config/db");
const { getCache, setCache, invalidateNamespace } = require("../lib/cache");
const {
  MODULES,
  USER_ROLE_DEFAULTS,
  GROUP_PRESETS,
  LEGACY_ROLE_GROUPS,
  allPermissionKeys,
  getPermission,
} = require("./permissionCatalog");

const CACHE_NS = "rbac_perms";
const CACHE_TTL = 300; // 5 minutes
/** Process-local hot cache — skips Redis on every list request. */
const MEMORY_TTL_MS = 60_000;
/** @type {Map<string, { expiresAt: number, value: object }>} */
const memoryPermCache = new Map();

function normalizeSystemRole(role) {
  if (role === "admin") return "admin";
  // Legacy roles treated as user until migration remaps them
  return "user";
}

function isAdministrator(role) {
  return normalizeSystemRole(role) === "admin";
}

/**
 * Ensure catalog permissions and preset groups exist in the database.
 * Safe to call on every boot (idempotent).
 */
async function syncPermissionsToDb() {
  const keys = allPermissionKeys();
  for (const mod of MODULES) {
    for (const perm of mod.permissions) {
      await query(
        `INSERT INTO rbac_permissions (perm_key, module_key, module_label, label, description, is_dangerous)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           module_key = VALUES(module_key),
           module_label = VALUES(module_label),
           label = VALUES(label),
           description = VALUES(description),
           is_dangerous = VALUES(is_dangerous)`,
        [
          perm.key,
          mod.key,
          mod.label,
          perm.label,
          perm.description || null,
          perm.dangerous ? 1 : 0,
        ]
      );
    }
  }

  // Soft-remove permissions no longer in catalog
  if (keys.length) {
    const placeholders = keys.map(() => "?").join(",");
    await query(
      `UPDATE rbac_permissions SET is_active = 0 WHERE perm_key NOT IN (${placeholders})`,
      keys
    );
    await query(
      `UPDATE rbac_permissions SET is_active = 1 WHERE perm_key IN (${placeholders})`,
      keys
    );
  }

  for (const preset of GROUP_PRESETS) {
    const existing = await query(
      `SELECT id FROM rbac_groups WHERE slug = ? LIMIT 1`,
      [preset.slug]
    );
    let groupId;
    let isNew = false;
    if (existing[0]) {
      groupId = existing[0].id;
      await query(
        `UPDATE rbac_groups SET name = ?, description = ?, is_system = 1 WHERE id = ?`,
        [preset.name, preset.description, groupId]
      );
    } else {
      const result = await query(
        `INSERT INTO rbac_groups (slug, name, description, is_system) VALUES (?, ?, ?, 1)`,
        [preset.slug, preset.name, preset.description]
      );
      groupId = result.insertId;
      isNew = true;
    }

    // Only seed permissions for brand-new groups. Re-seeding on every boot
    // was wiping admin edits in Settings → Groups (e.g. adding buildings.view
    // to Finance) whenever nodemon restarted.
    if (!isNew) {
      const countRows = await query(
        `SELECT COUNT(*) AS c FROM rbac_group_permissions WHERE group_id = ?`,
        [groupId]
      );
      if (Number(countRows[0]?.c) > 0) continue;
    }

    await query(`DELETE FROM rbac_group_permissions WHERE group_id = ?`, [groupId]);
    for (const permKey of preset.permissions) {
      if (!getPermission(permKey)) continue;
      await query(
        `INSERT IGNORE INTO rbac_group_permissions (group_id, perm_key) VALUES (?, ?)`,
        [groupId, permKey]
      );
    }
  }

  // Campaign create/edit are administrator-only (API + UI). Drop from any group grants.
  await query(
    `DELETE FROM rbac_group_permissions WHERE perm_key IN ('campaigns.create', 'campaigns.edit')`
  );
  await query(
    `DELETE FROM rbac_user_permissions WHERE perm_key IN ('campaigns.create', 'campaigns.edit') AND effect = 'grant'`
  );
}

async function invalidateUserPermissionCache(userId) {
  if (userId != null) {
    memoryPermCache.delete(String(userId));
  } else {
    memoryPermCache.clear();
  }
  // Group / catalog changes can affect many users — clear the Redis namespace.
  await invalidateNamespace(CACHE_NS);
}

/**
 * Resolve effective permissions for a user.
 * Order: role defaults → group union → individual grants → individual denies.
 * Administrators always receive every catalog permission (groups/overrides ignored).
 *
 * @returns {Promise<{ permissions: string[], sources: Record<string, string[]>, groups: object[] }>}
 */
async function resolveUserPermissions(user) {
  if (!user?.id) {
    return { permissions: [], sources: {}, groups: [] };
  }

  const cacheKey = String(user.id);
  const mem = memoryPermCache.get(cacheKey);
  if (mem && mem.expiresAt > Date.now()) {
    return mem.value;
  }

  const cached = await getCache(CACHE_NS, cacheKey);
  if (cached) {
    memoryPermCache.set(cacheKey, {
      expiresAt: Date.now() + MEMORY_TTL_MS,
      value: cached,
    });
    return cached;
  }

  const role = normalizeSystemRole(user.role);
  /** @type {Map<string, Set<string>>} */
  const sources = new Map();

  function addSource(perm, source) {
    if (!sources.has(perm)) sources.set(perm, new Set());
    sources.get(perm).add(source);
  }

  /** @type {Set<string>} */
  const effective = new Set();

  const groups = await query(
    `SELECT g.id, g.slug, g.name, g.description
     FROM rbac_user_groups ug
     JOIN rbac_groups g ON g.id = ug.group_id
     WHERE ug.user_id = ? AND g.is_active = 1
     ORDER BY g.name ASC`,
    [user.id]
  );

  if (role === "admin") {
    for (const key of allPermissionKeys()) {
      effective.add(key);
      addSource(key, "role:administrator");
    }
  } else {
    for (const key of USER_ROLE_DEFAULTS) {
      effective.add(key);
      addSource(key, "role:user");
    }

    if (groups.length) {
      const groupIds = groups.map((g) => g.id);
      const placeholders = groupIds.map(() => "?").join(",");
      const groupPerms = await query(
        `SELECT gp.perm_key, g.slug AS group_slug
         FROM rbac_group_permissions gp
         JOIN rbac_groups g ON g.id = gp.group_id
         WHERE gp.group_id IN (${placeholders})`,
        groupIds
      );
      for (const row of groupPerms) {
        effective.add(row.perm_key);
        addSource(row.perm_key, `group:${row.group_slug}`);
      }
    }

    const overrides = await query(
      `SELECT perm_key, effect FROM rbac_user_permissions WHERE user_id = ?`,
      [user.id]
    );

    for (const row of overrides) {
      if (row.effect === "grant") {
        effective.add(row.perm_key);
        addSource(row.perm_key, "user:grant");
      } else if (row.effect === "deny") {
        effective.delete(row.perm_key);
        if (!sources.has(row.perm_key)) sources.set(row.perm_key, new Set());
        sources.get(row.perm_key).add("user:deny");
      }
    }
  }

  const permissions = [...effective].sort();
  const sourceObj = {};
  for (const [perm, set] of sources.entries()) {
    if (effective.has(perm) || set.has("user:deny")) {
      sourceObj[perm] = [...set];
    }
  }

  const result = {
    permissions,
    sources: sourceObj,
    groups: groups.map((g) => ({
      id: g.id,
      slug: g.slug,
      name: g.name,
      description: g.description,
    })),
  };

  await setCache(CACHE_NS, cacheKey, result, CACHE_TTL);
  memoryPermCache.set(cacheKey, {
    expiresAt: Date.now() + MEMORY_TTL_MS,
    value: result,
  });
  return result;
}

async function userHasPermission(user, permissionKey) {
  if (!permissionKey) return false;
  const { permissions } = await resolveUserPermissions(user);
  return permissions.includes(permissionKey);
}

async function userHasAnyPermission(user, keys) {
  if (!keys?.length) return false;
  const { permissions } = await resolveUserPermissions(user);
  const set = new Set(permissions);
  return keys.some((k) => set.has(k));
}

async function userHasAllPermissions(user, keys) {
  if (!keys?.length) return true;
  const { permissions } = await resolveUserPermissions(user);
  const set = new Set(permissions);
  return keys.every((k) => set.has(k));
}

function getCatalogForApi() {
  return MODULES.map((mod) => ({
    key: mod.key,
    label: mod.label,
    description: mod.description || null,
    permissions: mod.permissions.map((p) => ({
      key: p.key,
      label: p.label,
      description: p.description || null,
      dangerous: Boolean(p.dangerous),
    })),
  }));
}

/**
 * Write an audit row for permission / group changes.
 */
async function auditPermissionChange({
  actorUserId,
  targetUserId = null,
  targetGroupId = null,
  action,
  previousState = null,
  newState = null,
  ipAddress = null,
  userAgent = null,
}) {
  await query(
    `INSERT INTO rbac_permission_audit
      (actor_user_id, target_user_id, target_group_id, action, previous_state, new_state, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      actorUserId || null,
      targetUserId,
      targetGroupId,
      action,
      previousState ? JSON.stringify(previousState) : null,
      newState ? JSON.stringify(newState) : null,
      ipAddress,
      userAgent ? String(userAgent).slice(0, 512) : null,
    ]
  );
}

function clientMeta(req) {
  return {
    ipAddress:
      req.ip ||
      req.headers?.["x-forwarded-for"]?.toString()?.split(",")[0]?.trim() ||
      null,
    userAgent: req.headers?.["user-agent"] || null,
  };
}

/**
 * One-time assignment of legacy role → preset groups for users who have
 * legacy_role set but no group membership yet.
 */
async function assignLegacyGroupsToUsers() {
  const users = await query(
    `SELECT u.id, u.legacy_role
     FROM admin_users u
     WHERE u.legacy_role IS NOT NULL
       AND u.legacy_role <> ''
       AND NOT EXISTS (
         SELECT 1 FROM rbac_user_groups ug WHERE ug.user_id = u.id
       )`
  );

  for (const user of users) {
    const slugs = LEGACY_ROLE_GROUPS[user.legacy_role] || [];
    for (const slug of slugs) {
      const groups = await query(
        `SELECT id FROM rbac_groups WHERE slug = ? LIMIT 1`,
        [slug]
      );
      if (!groups[0]) continue;
      await query(
        `INSERT IGNORE INTO rbac_user_groups (user_id, group_id) VALUES (?, ?)`,
        [user.id, groups[0].id]
      );
    }
  }
}

/**
 * Boot hook: sync catalog, seed groups, map legacy roles.
 */
async function initializeRbac() {
  await syncPermissionsToDb();
  await assignLegacyGroupsToUsers();
}

module.exports = {
  syncPermissionsToDb,
  assignLegacyGroupsToUsers,
  initializeRbac,
  resolveUserPermissions,
  userHasPermission,
  userHasAnyPermission,
  userHasAllPermissions,
  invalidateUserPermissionCache,
  getCatalogForApi,
  auditPermissionChange,
  clientMeta,
  normalizeSystemRole,
  isAdministrator,
  CACHE_NS,
};
