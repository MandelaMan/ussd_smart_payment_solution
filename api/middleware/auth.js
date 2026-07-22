const jwt = require("jsonwebtoken");
const { query } = require("../config/db");

const COOKIE_NAME = "admin_token";
const JWT_ALGORITHM = "HS256";

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return secret;
}

function getCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "strict" : "lax",
    path: "/",
  };
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      tv: user.token_version ?? 0,
    },
    getJwtSecret(),
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "8h",
      algorithm: JWT_ALGORITHM,
    }
  );
}

function setAuthCookie(res, token) {
  const decoded = jwt.decode(token);
  const maxAge =
    decoded?.exp != null
      ? Math.max(0, decoded.exp * 1000 - Date.now())
      : 8 * 60 * 60 * 1000;
  res.cookie(COOKIE_NAME, token, {
    ...getCookieOptions(),
    maxAge,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, getCookieOptions());
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret(), { algorithms: [JWT_ALGORITHM] });
}

async function loadUserFromToken(decoded) {
  const rows = await query(
    `SELECT id, name, email, role, is_active, token_version
     FROM admin_users WHERE id = ? LIMIT 1`,
    [decoded.sub]
  );
  const user = rows[0];
  if (!user || !user.is_active) return null;
  const tokenVersion = decoded.tv ?? 0;
  if (Number(user.token_version ?? 0) !== Number(tokenVersion)) return null;
  return user;
}

async function invalidateUserTokens(userId) {
  await query(
    `UPDATE admin_users SET token_version = token_version + 1 WHERE id = ?`,
    [userId]
  );
}

async function authenticate(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const decoded = verifyToken(token);
    req.tokenExp = decoded.exp;
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
    const role = req.user.role === "viewer" ? "support" : req.user.role;
    if (!roles.includes(role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    return next();
  };
}

module.exports = {
  COOKIE_NAME,
  JWT_ALGORITHM,
  signToken,
  setAuthCookie,
  clearAuthCookie,
  verifyToken,
  loadUserFromToken,
  invalidateUserTokens,
  authenticate,
  requireRole,
};
