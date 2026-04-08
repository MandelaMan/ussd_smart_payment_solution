const express = require("express");
const {
  test,
  getZohoCustomers,
  getInvoices,
  createInvoice,
  getItems,
  getItemsBySkuPrefixes,
  getInvoiceTemplates,
  getCustomerByCompanyName,
} = require("../controllers/zoho.controller");

// Works fine
const router = express.Router();

router.get("/", test);
router.post("/", createInvoice);
router.get("/invoice-templates", getInvoiceTemplates);
router.get("/items/by-sku-prefixes", getItemsBySkuPrefixes);
router.get("/items", getItems);
router.get("/customers", getZohoCustomers);
router.get("/customer/:companyName", getCustomerByCompanyName);
router.get("/invoices", getInvoices);

module.exports = router;
