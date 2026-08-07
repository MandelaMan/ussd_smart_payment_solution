const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { query } = require("../config/db");
const {
  runWithActivityActor,
  actorFromUser,
} = require("../lib/activityActorContext");
const {
  isSessionActive,
  revokeAllSessionsForUser,
} = require("../services/adminSessionStore");

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

function signToken(user, options = {}) {
  const jti = options.jti || crypto.randomUUID();
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      tv: user.token_version ?? 0,
      jti,
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
  if (!decoded?.jti) return null;

  const rows = await query(
    `SELECT id, name, email, role, job_title, is_active, token_version, must_change_password
     FROM admin_users WHERE id = ? LIMIT 1`,
    [decoded.sub]
  );
  const user = rows[0];
  if (!user || !user.is_active) return null;
  const tokenVersion = decoded.tv ?? 0;
  if (Number(user.token_version ?? 0) !== Number(tokenVersion)) return null;

  const sessionOk = await isSessionActive(decoded.jti, user.id);
  if (!sessionOk) return null;

  return user;
}

async function invalidateUserTokens(userId) {
  await query(
    `UPDATE admin_users SET token_version = token_version + 1 WHERE id = ?`,
    [userId]
  );
  await revokeAllSessionsForUser(userId);
}

async function authenticate(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const decoded = verifyToken(token);
    req.tokenExp = decoded.exp;
    req.sessionJti = decoded.jti || null;
    const user = await loadUserFromToken(decoded);
    if (!user) {
      clearAuthCookie(res);
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    req.user = user;
    // Bind actor for activity logging across the request (including awaits).
    return runWithActivityActor(actorFromUser(user), () => next());
  } catch {
    clearAuthCookie(res);
    return res.status(401).json({ error: "Authentication required" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const raw = req.user.role === "viewer" ? "user" : req.user.role;
    const normalized = raw === "admin" ? "admin" : "user";
    // Accept either the normalized system role or legacy role strings still
    // present on unmigrated JWTs until the user re-authenticates.
    const allowed = new Set(roles.flatMap((r) => {
      if (r === "admin") return ["admin"];
      if (r === "user") return ["user", "support", "cfo", "partner", "ceo", "viewer"];
      return [r, normalized];
    }));
    if (!allowed.has(raw) && !allowed.has(normalized)) {
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
