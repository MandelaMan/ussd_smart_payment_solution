const express = require("express");
const {
  test,
  mpesaCallback,
  mpesaValidation,
  mpesaConfirmation,
  registerC2BUrls,
  simulateC2B,
  getTransactionSplitConfig,
  updateTransactionSplitConfig,
  getTransactionSplitLog,
  b2cResult,
  b2cTimeout,
} = require("../controllers/mpesa.controller");
const { authenticate, requireRole } = require("../middleware/auth");
const { requireMpesaCallbackAuth } = require("../middleware/webhookVerify");

const router = express.Router();
const mpesaGuard = requireMpesaCallbackAuth;

router.get("/", test);

// Daraja STK Push callback (full URL: POST /api/payment/callback)
router.get("/callback", (_req, res) => {
  res.status(200).json({
    ok: true,
    message:
      "M-Pesa STK callback — Daraja must POST JSON (Body.stkCallback) to this path",
    path: "/api/payment/callback",
    method: "POST",
  });
});
router.post("/callback", mpesaGuard, mpesaCallback);

// Paybill / C2B (register these public URLs in Daraja): POST /api/payment/validation, POST /api/payment/confirmation
router.post("/validation", mpesaGuard, mpesaValidation);
router.post("/confirmation", mpesaGuard, mpesaConfirmation);

router.post("/register", authenticate, requireRole("admin"), registerC2BUrls);
router.post("/simulate", authenticate, requireRole("admin"), simulateC2B);
router.get("/split/config", authenticate, getTransactionSplitConfig);
router.put("/split/config", authenticate, requireRole("admin"), updateTransactionSplitConfig);
router.get("/split/logs", authenticate, getTransactionSplitLog);
router.post("/b2c/result", mpesaGuard, b2cResult);
router.post("/b2c/timeout", mpesaGuard, b2cTimeout);

module.exports = router;
