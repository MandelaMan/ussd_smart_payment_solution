const express = require("express");
const { test, mpesaCallback } = require("../controllers/mpesa.controller");

const router = express.Router();

router.get("/", test);
router.post("/callback", mpesaCallback);

module.exports = router;
