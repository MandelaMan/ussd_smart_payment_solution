const { logError } = require("../utils/errorLogger");

// Centralized error handler
module.exports = (err, req, res, _next) => {
  logError(err, {
    source: "express",
    method: req.method,
    path: req.originalUrl || req.url,
  });

  const status = err.status || 500;
  const isProd = process.env.NODE_ENV === "production";
  // Keep 4xx messages for clients; never leak driver/stack detail on 5xx in prod.
  const safeMessage =
    status >= 500 && isProd
      ? "Internal Server Error"
      : err.message || "Internal Server Error";
  const payload = {
    error: safeMessage,
    message: safeMessage,
    ...(err.retryAfterSeconds != null && { retryAfterSeconds: err.retryAfterSeconds }),
    ...(!isProd && { stack: err.stack }),
  };
  res.status(status).json(payload);
};
