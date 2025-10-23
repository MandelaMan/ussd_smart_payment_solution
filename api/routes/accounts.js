const express = require("express");
const Accounts = require("../controllers/AccountsController");
const router = express.Router();

router.post("/", Accounts.create);
router.get("/user/:userId", Accounts.listByUser);
router.get("/:id", Accounts.get);

module.exports = router;
