const express = require("express");
const {
  test,
  mpesaCallback,
  mpesaValidation,
  mpesaConfirmation,
  registerC2BUrls,
  simulateC2B,
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

router.post("/validation", mpesaValidation);
router.post("/confirmation", mpesaConfirmation);

router.post("/register", registerC2BUrls);
router.post("/simulate", simulateC2B);

module.exports = router;
