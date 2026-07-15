const bcrypt = require("bcrypt");
const { query } = require("../config/db");
const {
  signToken,
  setAuthCookie,
  clearAuthCookie,
} = require("../middleware/auth");

const VALID_ROLES = ["admin", "support", "cfo", "partner", "ceo"];

function isValidRole(role) {
  return VALID_ROLES.includes(role);
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const rows = await query(
      `SELECT id, name, email, password_hash, role, is_active
       FROM admin_users WHERE email = ? LIMIT 1`,
      [String(email).trim().toLowerCase()]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = signToken(user);
    setAuthCookie(res, token);

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role === "viewer" ? "support" : user.role,
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function logout(_req, res) {
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

    const hash = await bcrypt.hash(password, 12);
    await query(
      `INSERT INTO admin_users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`,
      [String(name).trim(), String(email).trim().toLowerCase(), hash, role]
    );
    return res.status(201).json({ ok: true });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Email already exists" });
    }
    // ENUM missing `ceo` (migration 032 not applied) surfaces as truncation.
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
    const { role, is_active } = req.body || {};
    const id = req.params.id;

    if (role && !isValidRole(role)) {
      return res.status(400).json({ error: "Role must be admin, support, cfo, partner, or ceo" });
    }

    const rows = await query(
      `SELECT id, role, is_active FROM admin_users WHERE id = ? LIMIT 1`,
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
    if (role) {
      updates.push("role = ?");
      params.push(role);
    }
    if (is_active !== undefined) {
      updates.push("is_active = ?");
      params.push(is_active ? 1 : 0);
    }
    if (!updates.length) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    params.push(id);
    await query(
      `UPDATE admin_users SET ${updates.join(", ")} WHERE id = ?`,
      params
    );
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

async function resetUserPassword(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { password } = req.body || {};
    if (!password || String(password).length < 8) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters" });
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
