const express = require("express");
const Tx = require("../controllers/TransactionsController");
const router = express.Router();

router.post("/deposit", Tx.deposit);
router.post("/withdraw", Tx.withdraw);
router.post("/transfer", Tx.transfer);
router.get("/account/:accountId", Tx.listByAccount);

module.exports = router;
