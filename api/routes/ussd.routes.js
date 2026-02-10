const express = require("express");
const {
  test,
  initiateUSSD,
  ussdCustomerDeatils,
} = require("../controllers/ussd.controller");

const router = express.Router();

router.get("/", test);
router.post("/", initiateUSSD);
router.post("/customer-details", ussdCustomerDeatils);
router.post("/customer", ussdCustomerDeatils);

module.exports = router;
