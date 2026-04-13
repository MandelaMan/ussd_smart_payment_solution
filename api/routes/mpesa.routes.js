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

const router = express.Router();

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
router.post("/callback", mpesaCallback);

// Paybill / C2B (register these public URLs in Daraja): POST /api/payment/validation, POST /api/payment/confirmation
router.post("/validation", mpesaValidation);
router.post("/confirmation", mpesaConfirmation);

router.post("/register", registerC2BUrls);
router.post("/simulate", simulateC2B);
router.get("/split/config", getTransactionSplitConfig);
router.put("/split/config", updateTransactionSplitConfig);
router.get("/split/logs", getTransactionSplitLog);
router.post("/b2c/result", b2cResult);
router.post("/b2c/timeout", b2cTimeout);

module.exports = router;
