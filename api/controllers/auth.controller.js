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

const VALID_ROLES = ["admin", "support", "cfo", "partner", "ceo"];

function isValidRole(role) {
  return VALID_ROLES.includes(role);
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

async function login(req, res, next) {
  const emailInput = req.body?.email ? normalizeEmail(req.body.email) : null;
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const rows = await query(
      `SELECT id, name, email, password_hash, role, is_active, token_version,
              failed_login_count, locked_until
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
      : new Date(Date.now() + 8 * 60 * 60 * 1000);

    await createSession({
      jti,
      userId: user.id,
      expiresAt,
      req,
    });
    // New login counts toward the cap; oldest sessions are revoked first.
    await enforceSessionLimit(user.id);

    setAuthCookie(res, token);

    await logAuthEvent({
      email: user.email,
      userId: user.id,
      outcome: "success",
      req,
    });

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role === "viewer" ? "support" : user.role,
      },
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
        // Revoke only this device/session so the other allowed session stays valid.
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

async function me(req, res) {
  return res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role === "viewer" ? "support" : req.user.role,
    },
    expiresAt: req.tokenExp ? req.tokenExp * 1000 : null,
  });
}

async function listUsers(_req, res, next) {
  try {
    const rows = await query(
      `SELECT id, name, email, role, is_active, created_at
       FROM admin_users ORDER BY created_at DESC`
    );
    return res.json({ users: rows });
  } catch (err) {
    return next(err);
  }
}

async function createUser(req, res, next) {
  try {
    const { name, email, password, role = "support" } = req.body || {};
    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ error: "Name, email, and password are required" });
    }
    if (!isValidRole(role)) {
      return res.status(400).json({ error: "Role must be admin, support, cfo, partner, or ceo" });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const hash = await bcrypt.hash(String(password), 12);
    const result = await query(
      `INSERT INTO admin_users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`,
      [String(name).trim(), normalizeEmail(email), hash, role]
    );
    await logActivitySafe({
      eventType: "user_created",
      title: "Admin user created",
      message: `${String(name).trim()} · ${normalizeEmail(email)} · ${role}`,
      source: "admin",
      referenceId: result.insertId != null ? String(result.insertId) : null,
      metadata: { role },
    });
    return res.status(201).json({ ok: true });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Unable to create user with this email" });
    }
    if (
      err.code === "WARN_DATA_TRUNCATED" ||
      err.errno === 1265 ||
      /Data truncated for column 'role'/i.test(err.message || "")
    ) {
      return res.status(500).json({
        error:
          "Database role column is missing the CEO value. Apply migration 032_ceo_role.sql (or ALTER admin_users.role ENUM to include 'ceo'), then retry.",
      });
    }
    return next(err);
  }
}

async function updateUser(req, res, next) {
  try {
    const { role, is_active, name } = req.body || {};
    const id = req.params.id;

    if (role && !isValidRole(role)) {
      return res.status(400).json({ error: "Role must be admin, support, cfo, partner, or ceo" });
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
      `SELECT id, name, role, is_active FROM admin_users WHERE id = ? LIMIT 1`,
      [id]
    );
    const target = rows[0];
    if (!target) {
      return res.status(404).json({ error: "User not found" });
    }

    if (target.role === "admin" && is_active === false) {
      return res.status(403).json({
        error: "Administrator accounts cannot be deactivated",
      });
    }

    const updates = [];
    const params = [];
    let shouldInvalidate = false;

    if (trimmedName !== undefined && trimmedName !== String(target.name || "").trim()) {
      updates.push("name = ?");
      params.push(trimmedName);
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
    if (!updates.length) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    params.push(id);
    await query(
      `UPDATE admin_users SET ${updates.join(", ")} WHERE id = ?`,
      params
    );

    if (shouldInvalidate) {
      await invalidateUserTokens(id);
    }

    const parts = [];
    if (trimmedName !== undefined && trimmedName !== String(target.name || "").trim()) {
      parts.push(`name → ${trimmedName}`);
    }
    if (role) parts.push(`role → ${role}`);
    if (is_active !== undefined) parts.push(is_active ? "activated" : "deactivated");
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

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

async function resetUserPassword(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { password } = req.body || {};

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const rows = await query(
      `SELECT id FROM admin_users WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "User not found" });
    }

    const hash = await bcrypt.hash(String(password), 12);
    await query(`UPDATE admin_users SET password_hash = ? WHERE id = ?`, [
      hash,
      id,
    ]);
    // Password change must invalidate every device session.
    await invalidateUserTokens(id);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  login,
  logout,
  me,
  listUsers,
  createUser,
  updateUser,
  resetUserPassword,
};
