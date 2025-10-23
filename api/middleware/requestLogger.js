// Small example of custom middleware (morgan is already used globally)
module.exports = (req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
};
