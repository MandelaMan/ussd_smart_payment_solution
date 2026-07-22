const express = require("express");
const { login, logout, me } = require("../controllers/auth.controller");
const { authenticate } = require("../middleware/auth");
const { loginLimiter, authApiLimiter } = require("../middleware/rateLimit");

const router = express.Router();

router.use(authApiLimiter);
router.post("/login", loginLimiter, login);
router.post("/logout", logout);
router.get("/me", authenticate, me);

module.exports = router;
