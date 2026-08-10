const {
  resolveUserPermissions,
  isAdministrator,
} = require("../rbac/permissionService");

/**
 * Resolve permissions once per request and attach to req.
 */
async function attachPermissions(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (req.userPermissionSet) return next();

    const resolved = await resolveUserPermissions(req.user);
    req.userPermissions = resolved.permissions;
    req.userPermissionSet = new Set(resolved.permissions);
    req.permissionSources = resolved.sources;
    req.userGroups = resolved.groups;
    return next();
  } catch (err) {
    return next(err);
  }
}

async function ensureReqPermissionSet(req) {
  if (req.userPermissionSet instanceof Set) return req.userPermissionSet;
  const resolved = await resolveUserPermissions(req.user);
  req.userPermissions = resolved.permissions;
  req.userPermissionSet = new Set(resolved.permissions);
  req.permissionSources = resolved.sources;
  req.userGroups = resolved.groups;
  return req.userPermissionSet;
}

/**
 * Require at least one of the given permission keys.
 */
function requirePermission(...keys) {
  const required = keys.filter(Boolean);
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }
      if (!required.length) return next();
      if (isAdministrator(req.user.role)) return next();

      const set = await ensureReqPermissionSet(req);
      const ok = required.some((k) => set.has(k));
      if (!ok) {
        return res.status(403).json({
          error: "Insufficient permissions",
          required: required.length === 1 ? required[0] : required,
        });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

function requireAllPermissions(...keys) {
  const required = keys.filter(Boolean);
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }
      if (isAdministrator(req.user.role)) return next();
      const set = await ensureReqPermissionSet(req);
      for (const key of required) {
        if (!set.has(key)) {
          return res.status(403).json({
            error: "Insufficient permissions",
            required: key,
          });
        }
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/** Administrator system role only (not merely holding admin-like permissions). */
function requireAdministrator(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (!isAdministrator(req.user.role)) {
    return res.status(403).json({ error: "Administrator role required" });
  }
  return next();
}

module.exports = {
  attachPermissions,
  ensureReqPermissionSet,
  requirePermission,
  requireAllPermissions,
  requireAdministrator,
};
