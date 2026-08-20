const express = require("express");
const {
  login,
  logout,
  me,
  changePassword,
  requestAccountRecovery,
  stopImpersonation,
} = require("../controllers/auth.controller");
const { authenticate } = require("../middleware/auth");
const {
  loginLimiter,
  recoverAccountLimiter,
  authApiLimiter,
  authMeLimiter,
} = require("../middleware/rateLimit");

const router = express.Router();

function noStoreCache(_req, res, next) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, private"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  // Prevent Express fresh()/ETag from turning identical /auth/me bodies into 304s
  // (fetch treats 304 as failure and the admin client would drop the session).
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    res.removeHeader("ETag");
    return sendJson(body);
  };
  next();
}

router.use(noStoreCache);
router.post("/login", authApiLimiter, loginLimiter, login);
router.post(
  "/recover-account",
  authApiLimiter,
  recoverAccountLimiter,
  requestAccountRecovery
);
router.post("/logout", authApiLimiter, logout);
router.post("/stop-impersonation", authApiLimiter, stopImpersonation);
// Session probes run on focus/visibility — allow more headroom than mutations.
router.get("/me", authMeLimiter, authenticate, me);
router.post("/change-password", authApiLimiter, authenticate, changePassword);

module.exports = router;
