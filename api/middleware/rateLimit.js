const { clientIp } = require("../utils/authLogger");

/**
 * Lightweight sliding-window rate limiter (no external deps).
 * Tracks attempts per IP in memory — suitable for single-process deployments;
 * use Redis-backed limiter for multi-instance production if needed.
 */
function createRateLimiter({ windowMs, max, message }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now - entry.start >= windowMs) hits.delete(key);
    }
  }, windowMs).unref?.();

  return function rateLimitMiddleware(req, res, next) {
    const key = clientIp(req) || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    let entry = hits.get(key);

    if (!entry || now - entry.start >= windowMs) {
      entry = { start: now, count: 0 };
      hits.set(key, entry);
    }

    entry.count += 1;

    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader(
      "X-RateLimit-Remaining",
      String(Math.max(0, max - entry.count))
    );

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.start + windowMs - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json(message);
    }
    return next();
  };
}

const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    error: "Too many login attempts. Please try again in 15 minutes.",
  },
});

const authApiLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Too many requests. Please slow down." },
});

module.exports = { createRateLimiter, loginLimiter, authApiLimiter };
