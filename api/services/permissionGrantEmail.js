/**
 * Email staff when they are granted new permissions.
 * Revocations are never emailed — only newly effective access.
 */
const { query } = require("../config/db");
const { sendZohoMail, isZohoMailConfigured } = require("../utils/zohoMail");
const { resolveUserPermissions } = require("../rbac/permissionService");
const {
  diffGrantedPermissionKeys,
  buildPermissionGrantEmail,
  shouldSendPermissionGrantEmail,
  becameAdministrator,
} = require("../utils/permissionGrantEmail");

async function snapshotEffectivePermissionKeys(user) {
  const resolved = await resolveUserPermissions(user);
  return resolved.permissions || [];
}

async function snapshotUsersForPermissionNotify(users) {
  const snapshots = [];
  for (const user of users || []) {
    if (!user?.id) continue;
    snapshots.push({
      userId: Number(user.id),
      previousKeys: await snapshotEffectivePermissionKeys(user),
      previousRole: user.role,
    });
  }
  return snapshots;
}

async function loadAdminUser(userId) {
  const rows = await query(
    `SELECT id, name, email, role, is_active FROM admin_users WHERE id = ? LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function loadGroupMemberUsers(groupId) {
  return query(
    `SELECT u.id, u.name, u.email, u.role, u.is_active
     FROM admin_users u
     INNER JOIN rbac_user_groups ug ON ug.user_id = u.id
     WHERE ug.group_id = ?`,
    [groupId]
  );
}

/**
 * After a permission-affecting change (and cache invalidation), email the user
 * only if their effective access grew. Failures are logged and never thrown.
 */
async function notifyIfNewPermissionsGranted({
  user,
  previousKeys,
  previousRole,
}) {
  try {
    if (!user?.id) return { sent: false, reason: "no_user" };
    if (!isZohoMailConfigured()) return { sent: false, reason: "mail_not_configured" };

    const resolved = await resolveUserPermissions(user);
    const grantedKeys = diffGrantedPermissionKeys(
      previousKeys,
      resolved.permissions
    );
    const promoted = becameAdministrator(previousRole, user.role);

    if (
      !shouldSendPermissionGrantEmail({
        user,
        grantedKeys,
        becameAdministrator: promoted,
      })
    ) {
      return { sent: false, reason: "no_grants", grantedKeys };
    }

    await sendZohoMail(
      buildPermissionGrantEmail({
        name: user.name,
        email: user.email,
        grantedKeys,
        becameAdministrator: promoted,
      })
    );
    return { sent: true, grantedKeys, becameAdministrator: promoted };
  } catch (err) {
    console.error(
      `[rbac] permission grant email failed for user ${user?.id}:`,
      err.message
    );
    return { sent: false, reason: "send_failed", error: err.message };
  }
}

async function notifyUsersOfGrantedPermissions(snapshots) {
  if (!snapshots?.length) return [];
  const results = [];
  for (const snap of snapshots) {
    const user = await loadAdminUser(snap.userId);
    if (!user) continue;
    results.push(
      await notifyIfNewPermissionsGranted({
        user,
        previousKeys: snap.previousKeys,
        previousRole: snap.previousRole,
      })
    );
  }
  return results;
}

module.exports = {
  snapshotEffectivePermissionKeys,
  snapshotUsersForPermissionNotify,
  loadGroupMemberUsers,
  notifyIfNewPermissionsGranted,
  notifyUsersOfGrantedPermissions,
};
