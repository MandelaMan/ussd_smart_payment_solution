const express = require("express");
const {
  test,
  initiateUSSD,
  ussdCustomerDeatils,
} = require("../controllers/ussd.controller");
const { requireUssdSecret } = require("../middleware/ussdApiAuth");

const router = express.Router();

router.get("/", test);
router.post("/", initiateUSSD);
router.post("/customer-details", requireUssdSecret, ussdCustomerDeatils);
router.post("/customer", requireUssdSecret, ussdCustomerDeatils);

module.exports = router;
