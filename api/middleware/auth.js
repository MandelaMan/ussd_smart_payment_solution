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
const ORIGINAL_COOKIE_NAME = "admin_token_original";
const JWT_ALGORITHM = "HS256";
const DEFAULT_IMPERSONATION_EXPIRES_IN = "2h";

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

function cookieMaxAgeMs(token) {
  const decoded = jwt.decode(token);
  if (decoded?.exp != null) {
    return Math.max(0, decoded.exp * 1000 - Date.now());
  }
  return 7 * 24 * 60 * 60 * 1000;
}

function signToken(user, options = {}) {
  const jti = options.jti || crypto.randomUUID();
  const claims =
    options.claims && typeof options.claims === "object" ? options.claims : {};
  return jwt.sign(
    {
      ...claims,
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      tv: user.token_version ?? 0,
      jti,
    },
    getJwtSecret(),
    {
      expiresIn:
        options.expiresIn || process.env.JWT_EXPIRES_IN || "7d",
      algorithm: JWT_ALGORITHM,
    }
  );
}

function setNamedAuthCookie(res, cookieName, token) {
  res.cookie(cookieName, token, {
    ...getCookieOptions(),
    maxAge: cookieMaxAgeMs(token),
  });
}

function setAuthCookie(res, token) {
  setNamedAuthCookie(res, COOKIE_NAME, token);
}

function setOriginalAuthCookie(res, token) {
  setNamedAuthCookie(res, ORIGINAL_COOKIE_NAME, token);
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, getCookieOptions());
}

function clearOriginalAuthCookie(res) {
  res.clearCookie(ORIGINAL_COOKIE_NAME, getCookieOptions());
}

function clearAllAuthCookies(res) {
  clearAuthCookie(res);
  clearOriginalAuthCookie(res);
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

/**
 * Validate the real administrator behind an impersonation JWT.
 * @returns {Promise<{ id: number, name: string, email: string } | null>}
 */
async function loadImpersonator(decoded) {
  if (!decoded?.imp) return null;
  const impersonatorId = Number(decoded.impersonatorId);
  if (!Number.isFinite(impersonatorId) || impersonatorId <= 0) return null;

  const rows = await query(
    `SELECT id, name, email, role, is_active
     FROM admin_users WHERE id = ? LIMIT 1`,
    [impersonatorId]
  );
  const actor = rows[0];
  if (!actor || !actor.is_active) return null;
  if (actor.role !== "admin") return null;
  return { id: actor.id, name: actor.name, email: actor.email };
}

async function invalidateUserTokens(userId) {
  await query(
    `UPDATE admin_users SET token_version = token_version + 1 WHERE id = ?`,
    [userId]
  );
  await revokeAllSessionsForUser(userId);
}

/**
 * If an impersonation cookie is gone, restore the stacked administrator session.
 * @returns {Promise<boolean>}
 */
async function restoreOriginalSession(req, res) {
  const originalToken = req.cookies?.[ORIGINAL_COOKIE_NAME];
  if (!originalToken) return false;
  try {
    const originalDecoded = verifyToken(originalToken);
    const originalUser = await loadUserFromToken(originalDecoded);
    if (!originalUser) return false;
    setAuthCookie(res, originalToken);
    clearOriginalAuthCookie(res);
    req.tokenExp = originalDecoded.exp;
    req.sessionJti = originalDecoded.jti || null;
    req.user = originalUser;
    req.impersonator = null;
    return true;
  } catch {
    return false;
  }
}

function bindActivityActor(req, next) {
  const impersonator = req.impersonator;
  const user = req.user;
  const actor = impersonator
    ? {
        id: impersonator.id,
        name: `${impersonator.name} (as ${user.name})`,
      }
    : user;
  return runWithActivityActor(actorFromUser(actor), () => next());
}

async function authenticate(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    const restored = await restoreOriginalSession(req, res);
    if (restored) return bindActivityActor(req, next);
    clearAuthCookie(res);
    return res.status(401).json({ error: "Authentication required" });
  }

  req.tokenExp = decoded.exp;
  req.sessionJti = decoded.jti || null;

  let user;
  try {
    user = await loadUserFromToken(decoded);
  } catch {
    // DB blip / pool restart — do not destroy a still-valid session cookie.
    return res
      .status(503)
      .json({ error: "Authentication temporarily unavailable" });
  }

  if (!user) {
    const restored = await restoreOriginalSession(req, res);
    if (restored) return bindActivityActor(req, next);
    clearAllAuthCookies(res);
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  let impersonator = null;
  if (decoded.imp) {
    try {
      impersonator = await loadImpersonator(decoded);
    } catch {
      return res
        .status(503)
        .json({ error: "Authentication temporarily unavailable" });
    }
    if (!impersonator) {
      const restored = await restoreOriginalSession(req, res);
      if (restored) return bindActivityActor(req, next);
      clearAllAuthCookies(res);
      return res.status(401).json({ error: "Invalid or expired session" });
    }
  }

  req.user = user;
  req.impersonator = impersonator;
  return bindActivityActor(req, next);
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
  ORIGINAL_COOKIE_NAME,
  JWT_ALGORITHM,
  DEFAULT_IMPERSONATION_EXPIRES_IN,
  signToken,
  setAuthCookie,
  setOriginalAuthCookie,
  clearAuthCookie,
  clearOriginalAuthCookie,
  clearAllAuthCookies,
  verifyToken,
  loadUserFromToken,
  loadImpersonator,
  invalidateUserTokens,
  authenticate,
  requireRole,
};
