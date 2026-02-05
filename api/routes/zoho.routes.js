const express = require("express");
const {
  test,
  getZohoCustomers,
  getSpecificCustomer,
  getInvoices,
  createInvoice,
  getItems,
  getInvoiceTemplates,
  getCustomerByCompanyName,
} = require("../controllers/zoho.controller");

const router = express.Router();

router.get("/", test);
router.post("/", createInvoice);
router.get("/invoice-templates", getInvoiceTemplates);
router.get("/items", getItems);
router.get("/customers", getZohoCustomers);
router.get("/customer/:companyName", getCustomerByCompanyName);
router.get("/invoices", getInvoices);

module.exports = router;
