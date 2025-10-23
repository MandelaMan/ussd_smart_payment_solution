// Centralized error handler
module.exports = (err, req, res, _next) => {
  const status = err.status || 500;
  const payload = {
    message: err.message || "Internal Server Error",
    // Only include stack in non-production
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  };
  res.status(status).json(payload);
};
