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
router.post("/callback", mpesaCallback);
router.post("/validation", mpesaValidation);
router.post("/confirmation", mpesaConfirmation);
router.post("/register", registerC2BUrls);
router.post("/simulate", simulateC2B);

module.exports = router;
