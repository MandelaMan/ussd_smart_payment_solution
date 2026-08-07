const { query } = require("../config/db");
const {
  getCatalogForApi,
  resolveUserPermissions,
  invalidateUserPermissionCache,
  auditPermissionChange,
  clientMeta,
} = require("../rbac/permissionService");
const { getPermission: lookupPerm } = require("../rbac/permissionCatalog");

async function listPermissionCatalog(_req, res) {
  return res.json({ modules: getCatalogForApi() });
}

async function listGroups(_req, res, next) {
  try {
    const groups = await query(
      `SELECT g.id, g.slug, g.name, g.description, g.is_system, g.is_active,
              (SELECT COUNT(*) FROM rbac_user_groups ug WHERE ug.group_id = g.id) AS member_count
       FROM rbac_groups g
       ORDER BY g.name ASC`
    );
    const perms = await query(
      `SELECT group_id, perm_key FROM rbac_group_permissions`
    );
    const byGroup = new Map();
    for (const row of perms) {
      if (!byGroup.has(row.group_id)) byGroup.set(row.group_id, []);
      byGroup.get(row.group_id).push(row.perm_key);
    }
    return res.json({
      groups: groups.map((g) => ({
        id: g.id,
        slug: g.slug,
        name: g.name,
        description: g.description,
        isSystem: Boolean(g.is_system),
        isActive: Boolean(g.is_active),
        memberCount: Number(g.member_count) || 0,
        permissions: (byGroup.get(g.id) || []).sort(),
      })),
    });
  } catch (err) {
    return next(err);
  }
}

async function getGroup(req, res, next) {
  try {
    const rows = await query(
      `SELECT id, slug, name, description, is_system, is_active
       FROM rbac_groups WHERE id = ? LIMIT 1`,
      [req.params.id]
    );
    const group = rows[0];
    if (!group) return res.status(404).json({ error: "Group not found" });
    const perms = await query(
      `SELECT perm_key FROM rbac_group_permissions WHERE group_id = ?`,
      [group.id]
    );
    return res.json({
      group: {
        id: group.id,
        slug: group.slug,
        name: group.name,
        description: group.description,
        isSystem: Boolean(group.is_system),
        isActive: Boolean(group.is_active),
        permissions: perms.map((p) => p.perm_key).sort(),
      },
    });
  } catch (err) {
    return next(err);
  }
}

function slugify(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

async function createGroup(req, res, next) {
  try {
    const { name, description, permissions = [], slug: slugInput } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "Group name is required" });
    }
    const slug = slugInput ? slugify(slugInput) : slugify(name);
    if (!slug) return res.status(400).json({ error: "Invalid group slug" });

    const result = await query(
      `INSERT INTO rbac_groups (slug, name, description, is_system) VALUES (?, ?, ?, 0)`,
      [slug, String(name).trim(), description ? String(description).trim() : null]
    );
    const groupId = result.insertId;

    const validPerms = [];
    for (const key of permissions) {
      if (!lookupPerm(key)) continue;
      await query(
        `INSERT IGNORE INTO rbac_group_permissions (group_id, perm_key) VALUES (?, ?)`,
        [groupId, key]
      );
      validPerms.push(key);
    }

    const meta = clientMeta(req);
    await auditPermissionChange({
      actorUserId: req.user.id,
      targetGroupId: groupId,
      action: "group_created",
      newState: { name, slug, permissions: validPerms },
      ...meta,
    });
    await invalidateUserPermissionCache();

    return res.status(201).json({ ok: true, id: groupId });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "A group with this slug already exists" });
    }
    return next(err);
  }
}

async function updateGroup(req, res, next) {
  try {
    const groupId = Number(req.params.id);
    const { name, description, permissions, is_active } = req.body || {};

    const rows = await query(
      `SELECT id, slug, name, description, is_system, is_active FROM rbac_groups WHERE id = ? LIMIT 1`,
      [groupId]
    );
    const group = rows[0];
    if (!group) return res.status(404).json({ error: "Group not found" });

    const prevPerms = await query(
      `SELECT perm_key FROM rbac_group_permissions WHERE group_id = ?`,
      [groupId]
    );
    const previousState = {
      name: group.name,
      description: group.description,
      isActive: Boolean(group.is_active),
      permissions: prevPerms.map((p) => p.perm_key).sort(),
    };

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) return res.status(400).json({ error: "Name cannot be empty" });
      await query(`UPDATE rbac_groups SET name = ? WHERE id = ?`, [trimmed, groupId]);
    }
    if (description !== undefined) {
      await query(`UPDATE rbac_groups SET description = ? WHERE id = ?`, [
        description ? String(description).trim() : null,
        groupId,
      ]);
    }
    if (is_active !== undefined) {
      await query(`UPDATE rbac_groups SET is_active = ? WHERE id = ?`, [
        is_active ? 1 : 0,
        groupId,
      ]);
    }

    let nextPerms = previousState.permissions;
    if (Array.isArray(permissions)) {
      await query(`DELETE FROM rbac_group_permissions WHERE group_id = ?`, [groupId]);
      nextPerms = [];
      for (const key of permissions) {
        if (!lookupPerm(key)) continue;
        await query(
          `INSERT IGNORE INTO rbac_group_permissions (group_id, perm_key) VALUES (?, ?)`,
          [groupId, key]
        );
        nextPerms.push(key);
      }
      nextPerms.sort();
    }

    const meta = clientMeta(req);
    await auditPermissionChange({
      actorUserId: req.user.id,
      targetGroupId: groupId,
      action: "group_updated",
      previousState,
      newState: {
        name: name !== undefined ? String(name).trim() : group.name,
        description:
          description !== undefined
            ? description
              ? String(description).trim()
              : null
            : group.description,
        isActive: is_active !== undefined ? Boolean(is_active) : Boolean(group.is_active),
        permissions: nextPerms,
      },
      ...meta,
    });
    await invalidateUserPermissionCache();

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

async function deleteGroup(req, res, next) {
  try {
    const groupId = Number(req.params.id);
    const rows = await query(
      `SELECT id, slug, name, is_system FROM rbac_groups WHERE id = ? LIMIT 1`,
      [groupId]
    );
    const group = rows[0];
    if (!group) return res.status(404).json({ error: "Group not found" });
    if (group.is_system) {
      return res.status(403).json({ error: "System groups cannot be deleted" });
    }

    const meta = clientMeta(req);
    await auditPermissionChange({
      actorUserId: req.user.id,
      targetGroupId: groupId,
      action: "group_deleted",
      previousState: { slug: group.slug, name: group.name },
      ...meta,
    });

    await query(`DELETE FROM rbac_groups WHERE id = ?`, [groupId]);
    await invalidateUserPermissionCache();
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

async function getUserEffectivePermissions(req, res, next) {
  try {
    const userId = Number(req.params.id);
    const rows = await query(
      `SELECT id, name, email, role FROM admin_users WHERE id = ? LIMIT 1`,
      [userId]
    );
    if (!rows[0]) return res.status(404).json({ error: "User not found" });

    const overrides = await query(
      `SELECT perm_key, effect FROM rbac_user_permissions WHERE user_id = ?`,
      [userId]
    );
    const resolved = await resolveUserPermissions(rows[0]);

    return res.json({
      userId,
      role: rows[0].role,
      groups: resolved.groups,
      permissions: resolved.permissions,
      sources: resolved.sources,
      overrides: overrides.map((o) => ({
        key: o.perm_key,
        effect: o.effect,
      })),
      catalog: getCatalogForApi(),
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * Replace individual permission overrides for a user.
 * Body: { grants: string[], denies: string[] }
 * Explicit grants/denies override group inheritance; omitted keys inherit.
 */
async function setUserPermissionOverrides(req, res, next) {
  try {
    const userId = Number(req.params.id);
    const { grants = [], denies = [] } = req.body || {};

    const rows = await query(
      `SELECT id, role FROM admin_users WHERE id = ? LIMIT 1`,
      [userId]
    );
    if (!rows[0]) return res.status(404).json({ error: "User not found" });

    const prev = await query(
      `SELECT perm_key, effect FROM rbac_user_permissions WHERE user_id = ?`,
      [userId]
    );

    const grantSet = new Set(
      (Array.isArray(grants) ? grants : []).filter((k) => lookupPerm(k))
    );
    const denySet = new Set(
      (Array.isArray(denies) ? denies : []).filter((k) => lookupPerm(k))
    );
    for (const key of denySet) {
      grantSet.delete(key);
    }

    await query(`DELETE FROM rbac_user_permissions WHERE user_id = ?`, [userId]);
    for (const key of grantSet) {
      await query(
        `INSERT INTO rbac_user_permissions (user_id, perm_key, effect) VALUES (?, ?, 'grant')`,
        [userId, key]
      );
    }
    for (const key of denySet) {
      await query(
        `INSERT INTO rbac_user_permissions (user_id, perm_key, effect) VALUES (?, ?, 'deny')`,
        [userId, key]
      );
    }

    const meta = clientMeta(req);
    await auditPermissionChange({
      actorUserId: req.user.id,
      targetUserId: userId,
      action: "user_permissions_updated",
      previousState: {
        overrides: prev.map((p) => ({ key: p.perm_key, effect: p.effect })),
      },
      newState: {
        grants: [...grantSet].sort(),
        denies: [...denySet].sort(),
      },
      ...meta,
    });
    await invalidateUserPermissionCache();

    const resolved = await resolveUserPermissions(rows[0]);
    return res.json({
      ok: true,
      permissions: resolved.permissions,
      sources: resolved.sources,
    });
  } catch (err) {
    return next(err);
  }
}

async function listPermissionAudit(req, res, next) {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await query(
      `SELECT a.id, a.actor_user_id, a.target_user_id, a.target_group_id,
              a.action, a.previous_state, a.new_state, a.ip_address, a.created_at,
              actor.name AS actor_name, target.name AS target_name
       FROM rbac_permission_audit a
       LEFT JOIN admin_users actor ON actor.id = a.actor_user_id
       LEFT JOIN admin_users target ON target.id = a.target_user_id
       ORDER BY a.created_at DESC
       LIMIT ?`,
      [limit]
    );
    return res.json({
      entries: rows.map((r) => ({
        id: r.id,
        action: r.action,
        actorUserId: r.actor_user_id,
        actorName: r.actor_name,
        targetUserId: r.target_user_id,
        targetName: r.target_name,
        targetGroupId: r.target_group_id,
        previousState:
          typeof r.previous_state === "string"
            ? JSON.parse(r.previous_state)
            : r.previous_state,
        newState:
          typeof r.new_state === "string" ? JSON.parse(r.new_state) : r.new_state,
        ipAddress: r.ip_address,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listPermissionCatalog,
  listGroups,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  getUserEffectivePermissions,
  setUserPermissionOverrides,
  listPermissionAudit,
};
