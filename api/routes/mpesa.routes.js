const express = require("express");
const {
  test,
  mpesaCallback,
  mpesaValidation,
  mpesaConfirmation,
} = require("../controllers/mpesa.controller");

const router = express.Router();

router.get("/", test);
router.post("/callback", mpesaCallback);
router.post("/validation", mpesaValidation);
router.post("/confirmation", mpesaConfirmation);

module.exports = router;
