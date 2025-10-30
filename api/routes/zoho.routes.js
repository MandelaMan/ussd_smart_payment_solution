const express = require("express");
const {
  test,
  getZohoCustomers,
  getSpecificCustomer,
} = require("../controllers/zoho.controller");

const router = express.Router();

router.get("/", test);
router.get("/customers", getZohoCustomers);
router.get("/customer/:idOrEmail", getSpecificCustomer);

module.exports = router;
