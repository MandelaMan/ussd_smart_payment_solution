const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { query } = require("../config/db");
const {
  signToken,
  setAuthCookie,
  clearAuthCookie,
  verifyToken,
  invalidateUserTokens,
  COOKIE_NAME,
} = require("../middleware/auth");
const { validatePassword } = require("../utils/passwordPolicy");
const { generateTemporaryPassword } = require("../utils/tempPassword");
const { sendZohoMail, isZohoMailConfigured } = require("../utils/zohoMail");
const { logAuthEvent } = require("../utils/authLogger");
const {
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MINUTES,
  isAccountLocked,
  lockoutMessage,
} = require("../utils/accountLockout");
const { logActivitySafe } = require("../services/activityLogStore");
const {
  newSessionId,
  createSession,
  enforceSessionLimit,
  revokeSession,
} = require("../services/adminSessionStore");
const {
  resolveUserPermissions,
  invalidateUserPermissionCache,
  auditPermissionChange,
  clientMeta,
  normalizeSystemRole,
  isAdministrator,
} = require("../rbac/permissionService");

const VALID_ROLES = ["admin", "user"];

function isValidRole(role) {
  return VALID_ROLES.includes(role);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function adminLoginUrl() {
  const origin = String(process.env.ADMIN_ORIGIN || "").replace(/\/$/, "");
  return origin ? `${origin}/login` : "/admin/login";
}

async function sendTemporaryPasswordEmail({ name, email, temporaryPassword }) {
  if (!isZohoMailConfigured()) {
    throw new Error(
      "Email is not configured — set Zoho Mail OAuth credentials, or copy the password instead"
    );
  }
  const loginUrl = adminLoginUrl();
  const safeName = escapeHtml(name || "there");
  const safePassword = escapeHtml(temporaryPassword);
  const safeUrl = escapeHtml(loginUrl);
  await sendZohoMail({
    toAddress: email,
    subject: "Your temporary admin password",
    content: `
      <p>Hello ${safeName},</p>
      <p>An administrator reset your account password. Use this temporary password to sign in:</p>
      <p style="font-family: monospace; font-size: 20px; letter-spacing: 0.08em; font-weight: bold;">${safePassword}</p>
      <p>Sign in at <a href="${safeUrl}">${safeUrl}</a>. You will be asked to choose a new password immediately.</p>
      <p>If you did not expect this message, contact your administrator.</p>
    `,
  });
}


function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

async function recordFailedLogin(userId) {
  await query(
    `UPDATE admin_users
     SET failed_login_count = failed_login_count + 1,
         locked_until = IF(
           failed_login_count + 1 >= ?,
           DATE_ADD(NOW(), INTERVAL ? MINUTE),
           locked_until
         )
     WHERE id = ?`,
    [MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES, userId]
  );
}

async function resetFailedLogins(userId) {
  await query(
    `UPDATE admin_users SET failed_login_count = 0, locked_until = NULL WHERE id = ?`,
    [userId]
  );
}

async function buildAuthUserPayload(user) {
  const resolved = await resolveUserPermissions(user);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: normalizeSystemRole(user.role),
    jobTitle: user.job_title || null,
    mustChangePassword: Boolean(user.must_change_password),
    permissions: resolved.permissions,
    groups: resolved.groups,
  };
}

async function setUserGroups(userId, groupIds) {
  const ids = [...new Set((groupIds || []).map(Number).filter((n) => n > 0))];
  await query(`DELETE FROM rbac_user_groups WHERE user_id = ?`, [userId]);
  for (const groupId of ids) {
    const exists = await query(
      `SELECT id FROM rbac_groups WHERE id = ? AND is_active = 1 LIMIT 1`,
      [groupId]
    );
    if (!exists[0]) continue;
    await query(
      `INSERT IGNORE INTO rbac_user_groups (user_id, group_id) VALUES (?, ?)`,
      [userId, groupId]
    );
  }
}

async function login(req, res, next) {
  const emailInput = req.body?.email ? normalizeEmail(req.body.email) : null;
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const rows = await query(
      `SELECT id, name, email, password_hash, role, job_title, is_active, token_version,
              failed_login_count, locked_until, must_change_password
       FROM admin_users WHERE email = ? LIMIT 1`,
      [emailInput]
    );
    const user = rows[0];

    if (user && isAccountLocked(user)) {
      await logAuthEvent({
        email: emailInput,
        userId: user.id,
        outcome: "lockout",
        req,
        reason: "account_locked",
      });
      return res.status(429).json(lockoutMessage(user));
    }

    if (!user || !user.is_active) {
      await logAuthEvent({
        email: emailInput,
        outcome: "failure",
        req,
        reason: "invalid_credentials",
      });
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(String(password), user.password_hash);
    if (!valid) {
      await recordFailedLogin(user.id);
      const updated = await query(
        `SELECT locked_until FROM admin_users WHERE id = ? LIMIT 1`,
        [user.id]
      );
      const locked = isAccountLocked(updated[0]);
      await logAuthEvent({
        email: emailInput,
        userId: user.id,
        outcome: locked ? "lockout" : "failure",
        req,
        reason: "invalid_credentials",
      });
      if (locked) {
        return res.status(429).json(lockoutMessage(updated[0]));
      }
      return res.status(401).json({ error: "Invalid email or password" });
    }

    await resetFailedLogins(user.id);

    const jti = newSessionId();
    const token = signToken(user, { jti });
    const decoded = jwt.decode(token);
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await createSession({
      jti,
      userId: user.id,
      expiresAt,
      req,
    });
    await enforceSessionLimit(user.id);

    setAuthCookie(res, token);

    await logAuthEvent({
      email: user.email,
      userId: user.id,
      outcome: "success",
      req,
    });

    const authUser = await buildAuthUserPayload(user);
    return res.json({
      user: authUser,
      expiresAt: decoded?.exp ? decoded.exp * 1000 : null,
    });
  } catch (err) {
    return next(err);
  }
}

async function logout(req, res) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) {
      try {
        const decoded = verifyToken(token);
        if (decoded.jti) {
          await revokeSession(decoded.jti, decoded.sub);
        }
        await logAuthEvent({
          email: decoded.email,
          userId: decoded.sub,
          outcome: "logout",
          req,
        });
      } catch {
        /* token already invalid — still clear cookie */
      }
    }
  } catch {
    /* best-effort invalidation */
  }
  clearAuthCookie(res);
  return res.json({ ok: true });
}

async function me(req, res, next) {
  try {
    const rows = await query(
      `SELECT id, name, email, role, job_title, must_change_password
       FROM admin_users WHERE id = ? LIMIT 1`,
      [req.user.id]
    );
    const user = rows[0] || req.user;
    const authUser = await buildAuthUserPayload(user);
    return res.json({
      user: authUser,
      expiresAt: req.tokenExp ? req.tokenExp * 1000 : null,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * Force password change on first login / after temp reset.
 */
async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword) {
      return res.status(400).json({ error: "New password is required" });
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const rows = await query(
      `SELECT id, password_hash, must_change_password FROM admin_users WHERE id = ? LIMIT 1`,
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!user.must_change_password) {
      if (!currentPassword) {
        return res.status(400).json({ error: "Current password is required" });
      }
      const valid = await bcrypt.compare(String(currentPassword), user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }
    }

    const hash = await bcrypt.hash(String(newPassword), 12);
    await query(
      `UPDATE admin_users SET password_hash = ?, must_change_password = 0 WHERE id = ?`,
      [hash, user.id]
    );
    await invalidateUserTokens(user.id);

    // Re-issue session cookie for the current device after invalidation
    const fresh = await query(
      `SELECT id, name, email, role, job_title, token_version, must_change_password
       FROM admin_users WHERE id = ? LIMIT 1`,
      [user.id]
    );
    const jti = newSessionId();
    const token = signToken(fresh[0], { jti });
    const decoded = jwt.decode(token);
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await createSession({ jti, userId: user.id, expiresAt, req });
    setAuthCookie(res, token);

    const authUser = await buildAuthUserPayload(fresh[0]);
    return res.json({
      ok: true,
      user: authUser,
      expiresAt: decoded?.exp ? decoded.exp * 1000 : null,
    });
  } catch (err) {
    return next(err);
  }
}

async function listUsers(_req, res, next) {
  try {
    const rows = await query(
      `SELECT u.id, u.name, u.email, u.role, u.job_title, u.notes, u.is_active,
              u.must_change_password, u.legacy_role, u.created_at
       FROM admin_users u
       ORDER BY u.created_at DESC`
    );

    const memberships = await query(
      `SELECT ug.user_id, g.id, g.slug, g.name
       FROM rbac_user_groups ug
       JOIN rbac_groups g ON g.id = ug.group_id
       WHERE g.is_active = 1
       ORDER BY g.name ASC`
    );
    const byUser = new Map();
    for (const row of memberships) {
      if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
      byUser.get(row.user_id).push({
        id: row.id,
        slug: row.slug,
        name: row.name,
      });
    }

    return res.json({
      users: rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: normalizeSystemRole(u.role),
        jobTitle: u.job_title || null,
        notes: u.notes || null,
        is_active: u.is_active,
        mustChangePassword: Boolean(u.must_change_password),
        legacyRole: u.legacy_role || null,
        created_at: u.created_at,
        groups: byUser.get(u.id) || [],
      })),
    });
  } catch (err) {
    return next(err);
  }
}

async function createUser(req, res, next) {
  try {
    const {
      name,
      email,
      role = "user",
      jobTitle,
      notes,
      is_active = true,
      groupIds = [],
      password: passwordInput,
    } = req.body || {};

    if (!name || !email) {
      return res.status(400).json({ error: "Full name and email are required" });
    }
    if (!isValidRole(role)) {
      return res.status(400).json({ error: "Role must be admin or user" });
    }

    const temporaryPassword = passwordInput
      ? String(passwordInput)
      : generateTemporaryPassword();

    if (passwordInput) {
      const passwordError = validatePassword(passwordInput);
      if (passwordError) {
        return res.status(400).json({ error: passwordError });
      }
    }

    const hash = await bcrypt.hash(temporaryPassword, 12);
    const result = await query(
      `INSERT INTO admin_users
        (name, email, password_hash, must_change_password, role, job_title, notes, is_active)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
      [
        String(name).trim(),
        normalizeEmail(email),
        hash,
        role,
        jobTitle ? String(jobTitle).trim() : null,
        notes ? String(notes).trim() : null,
        is_active ? 1 : 0,
      ]
    );

    const userId = result.insertId;
    await setUserGroups(userId, groupIds);
    await invalidateUserPermissionCache();

    const meta = clientMeta(req);
    await auditPermissionChange({
      actorUserId: req.user.id,
      targetUserId: userId,
      action: "user_created",
      newState: {
        role,
        groupIds,
        jobTitle: jobTitle || null,
        isActive: Boolean(is_active),
      },
      ...meta,
    });

    await logActivitySafe({
      eventType: "user_created",
      title: "Admin user created",
      message: `${String(name).trim()} · ${normalizeEmail(email)} · ${role}`,
      source: "admin",
      referenceId: userId != null ? String(userId) : null,
      metadata: { role, groupIds },
    });

    return res.status(201).json({
      ok: true,
      id: userId,
      temporaryPassword,
      mustChangePassword: true,
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Unable to create user with this email" });
    }
    return next(err);
  }
}

async function updateUser(req, res, next) {
  try {
    const {
      role,
      is_active,
      name,
      jobTitle,
      notes,
      groupIds,
    } = req.body || {};
    const id = req.params.id;

    if (role && !isValidRole(role)) {
      return res.status(400).json({ error: "Role must be admin or user" });
    }

    const trimmedName =
      name !== undefined && name !== null ? String(name).trim() : undefined;
    if (trimmedName !== undefined && !trimmedName) {
      return res.status(400).json({ error: "Name cannot be empty" });
    }
    if (trimmedName !== undefined && trimmedName.length > 191) {
      return res.status(400).json({ error: "Name must be at most 191 characters" });
    }

    const rows = await query(
      `SELECT id, name, email, role, job_title, notes, is_active
       FROM admin_users WHERE id = ? LIMIT 1`,
      [id]
    );
    const target = rows[0];
    if (!target) {
      return res.status(404).json({ error: "User not found" });
    }

    if (isAdministrator(target.role) && is_active === false) {
      return res.status(403).json({
        error: "Administrator accounts cannot be deactivated",
      });
    }

    const prevGroups = await query(
      `SELECT group_id FROM rbac_user_groups WHERE user_id = ?`,
      [id]
    );

    const updates = [];
    const params = [];
    let shouldInvalidate = false;

    if (trimmedName !== undefined && trimmedName !== String(target.name || "").trim()) {
      updates.push("name = ?");
      params.push(trimmedName);
    }
    if (jobTitle !== undefined) {
      updates.push("job_title = ?");
      params.push(jobTitle ? String(jobTitle).trim() : null);
    }
    if (notes !== undefined) {
      updates.push("notes = ?");
      params.push(notes ? String(notes).trim() : null);
    }
    if (role) {
      updates.push("role = ?");
      params.push(role);
      shouldInvalidate = true;
    }
    if (is_active !== undefined) {
      updates.push("is_active = ?");
      params.push(is_active ? 1 : 0);
      if (!is_active) shouldInvalidate = true;
    }

    if (updates.length) {
      params.push(id);
      await query(
        `UPDATE admin_users SET ${updates.join(", ")} WHERE id = ?`,
        params
      );
    }

    if (Array.isArray(groupIds)) {
      await setUserGroups(id, groupIds);
      shouldInvalidate = true;
      await invalidateUserPermissionCache();
    }

    if (shouldInvalidate && (role || is_active === false)) {
      await invalidateUserTokens(id);
    }

    const meta = clientMeta(req);
    await auditPermissionChange({
      actorUserId: req.user.id,
      targetUserId: Number(id),
      action: "user_updated",
      previousState: {
        name: target.name,
        role: target.role,
        jobTitle: target.job_title,
        notes: target.notes,
        isActive: Boolean(target.is_active),
        groupIds: prevGroups.map((g) => g.group_id),
      },
      newState: {
        name: trimmedName ?? target.name,
        role: role || target.role,
        jobTitle: jobTitle !== undefined ? jobTitle : target.job_title,
        notes: notes !== undefined ? notes : target.notes,
        isActive: is_active !== undefined ? Boolean(is_active) : Boolean(target.is_active),
        groupIds: Array.isArray(groupIds)
          ? groupIds
          : prevGroups.map((g) => g.group_id),
      },
      ...meta,
    });

    const parts = [];
    if (trimmedName !== undefined && trimmedName !== String(target.name || "").trim()) {
      parts.push(`name → ${trimmedName}`);
    }
    if (role) parts.push(`role → ${role}`);
    if (is_active !== undefined) parts.push(is_active ? "activated" : "deactivated");
    if (Array.isArray(groupIds)) parts.push("groups updated");
    await logActivitySafe({
      eventType: "user_updated",
      title: "Admin user updated",
      message: parts.length ? `User #${id} · ${parts.join(", ")}` : `User #${id}`,
      source: "admin",
      referenceId: String(id),
      metadata: {
        role: role || null,
        isActive: is_active,
        name: trimmedName || null,
        previousName: target.name || null,
      },
    });

    if (!updates.length && !Array.isArray(groupIds)) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

async function resetUserPassword(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { password, sendEmail } = req.body || {};

    const rows = await query(
      `SELECT id, name, email FROM admin_users WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "User not found" });
    }
    const target = rows[0];

    const temporaryPassword = password ? String(password) : generateTemporaryPassword();
    if (password) {
      const passwordError = validatePassword(password);
      if (passwordError) {
        return res.status(400).json({ error: passwordError });
      }
    }

    const hash = await bcrypt.hash(temporaryPassword, 12);
    await query(
      `UPDATE admin_users SET password_hash = ?, must_change_password = 1 WHERE id = ?`,
      [hash, id]
    );
    await invalidateUserTokens(id);

    const meta = clientMeta(req);
    await auditPermissionChange({
      actorUserId: req.user.id,
      targetUserId: id,
      action: "password_reset",
      newState: { mustChangePassword: true },
      ...meta,
    });

    let emailed = false;
    if (sendEmail) {
      await sendTemporaryPasswordEmail({
        name: target.name,
        email: target.email,
        temporaryPassword,
      });
      emailed = true;
    }

    return res.json({
      ok: true,
      temporaryPassword: password ? undefined : temporaryPassword,
      mustChangePassword: true,
      emailed,
      email: target.email,
    });
  } catch (err) {
    return next(err);
  }
}

async function emailTemporaryPassword(req, res, next) {
  try {
    const id = Number(req.params.id);
    const temporaryPassword = String(req.body?.temporaryPassword || "");
    if (!temporaryPassword) {
      return res.status(400).json({ error: "temporaryPassword is required" });
    }

    const rows = await query(
      `SELECT id, name, email, password_hash FROM admin_users WHERE id = ? LIMIT 1`,
      [id]
    );
    const target = rows[0];
    if (!target) {
      return res.status(404).json({ error: "User not found" });
    }

    const matches = await bcrypt.compare(temporaryPassword, target.password_hash);
    if (!matches) {
      return res.status(400).json({
        error: "Password does not match the current temporary password for this user",
      });
    }

    await sendTemporaryPasswordEmail({
      name: target.name,
      email: target.email,
      temporaryPassword,
    });

    const meta = clientMeta(req);
    await auditPermissionChange({
      actorUserId: req.user.id,
      targetUserId: id,
      action: "temporary_password_emailed",
      newState: { emailedTo: target.email },
      ...meta,
    });

    return res.json({ ok: true, emailed: true, email: target.email });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  login,
  logout,
  me,
  changePassword,
  listUsers,
  createUser,
  updateUser,
  resetUserPassword,
  emailTemporaryPassword,
};
