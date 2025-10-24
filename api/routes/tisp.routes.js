const express = require("express");
const { test } = require("../controllers/tisp.controller");

const router = express.Router();

router.post("/", test);

module.exports = router;
