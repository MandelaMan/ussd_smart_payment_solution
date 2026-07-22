const express = require("express");
const { test } = require("../controllers/tisp.controller");
const { requireOps } = require("../middleware/rbac");

const router = express.Router();

router.post("/", requireOps, test);

module.exports = router;
