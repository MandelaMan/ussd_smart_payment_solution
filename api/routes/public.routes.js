const express = require("express");
const { getLoginStats, zohoWebhook } = require("../controllers/public.controller");
const { authenticate } = require("../middleware/auth");
const { requireFinance } = require("../middleware/rbac");
const {
  publicCors,
  getLeadFormConfig,
  submitLead,
  whatsappWebhookVerify,
  whatsappWebhook,
  whatsappStatus,
} = require("../controllers/leadsPublic.controller");
const { createRateLimiter } = require("../middleware/rateLimit");

const router = express.Router();

const leadSubmitLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many submissions. Please try again later." },
});

router.get("/login-stats", authenticate, requireFinance, getLoginStats);
router.post("/zoho/webhook", zohoWebhook);

router.options("/leads", (req, res) => {
  publicCors(res);
  res.sendStatus(204);
});
router.options("/leads/config", (req, res) => {
  publicCors(res);
  res.sendStatus(204);
});
router.get("/leads/config", getLeadFormConfig);
router.post("/leads", leadSubmitLimiter, submitLead);

router.get("/whatsapp/webhook", whatsappWebhookVerify);
router.post("/whatsapp/webhook", whatsappWebhook);
router.get("/whatsapp/status", whatsappStatus);

module.exports = router;
