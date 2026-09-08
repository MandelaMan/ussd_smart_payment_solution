const express = require("express");
const { getLoginStats, zohoWebhook } = require("../controllers/public.controller");
const {
  publicCors,
  getLeadFormConfig,
  submitLead,
  getSignupFormConfig,
  getSignupPackages,
  submitSignup,
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

router.get("/login-stats", getLoginStats);
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

router.options("/leads/signup", (req, res) => {
  publicCors(res);
  res.sendStatus(204);
});
router.options("/leads/signup/config", (req, res) => {
  publicCors(res);
  res.sendStatus(204);
});
router.options("/leads/signup/packages", (req, res) => {
  publicCors(res);
  res.sendStatus(204);
});
router.get("/leads/signup/config", getSignupFormConfig);
router.get("/leads/signup/packages", getSignupPackages);
router.post("/leads/signup", leadSubmitLimiter, submitSignup);

router.get("/whatsapp/webhook", whatsappWebhookVerify);
router.post("/whatsapp/webhook", whatsappWebhook);
router.get("/whatsapp/status", whatsappStatus);

module.exports = router;
