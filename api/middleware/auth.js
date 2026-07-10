const jwt = require("jsonwebtoken");
const { query } = require("../config/db");

const COOKIE_NAME = "admin_token";

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return secret;
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
  );
}

function setAuthCookie(res, token) {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "strict" : "lax",
    maxAge: 8 * 60 * 60 * 1000,
    path: "/",
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

async function loadUserFromToken(decoded) {
  const rows = await query(
    `SELECT id, name, email, role, is_active FROM admin_users WHERE id = ? LIMIT 1`,
    [decoded.sub]
  );
  const user = rows[0];
  if (!user || !user.is_active) return null;
  return user;
}

async function authenticate(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const decoded = jwt.verify(token, getJwtSecret());
    const user = await loadUserFromToken(decoded);
    if (!user) {
      clearAuthCookie(res);
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    req.user = user;
    return next();
  } catch {
    clearAuthCookie(res);
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    return next();
  };
}

module.exports = {
  COOKIE_NAME,
  signToken,
  setAuthCookie,
  clearAuthCookie,
  authenticate,
  requireRole,
};
