const express = require("express");
const { test, initiateUSSD } = require("../controllers/ussd.controller");

const router = express.Router();

router.get("/", test);
router.post("/", initiateUSSD);

module.exports = router;
