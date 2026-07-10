const express = require("express");
const { getLoginStats, zohoWebhook } = require("../controllers/public.controller");

const router = express.Router();

router.get("/login-stats", getLoginStats);
router.post("/zoho/webhook", zohoWebhook);

module.exports = router;
