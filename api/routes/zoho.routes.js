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
const { requirePermission } = require("../middleware/permissions");

const router = express.Router();

router.get("/", requirePermission("settings.view"), test);
router.post("/", requirePermission("billing.actions", "customers.edit"), createInvoice);
router.get("/invoice-templates", requirePermission("billing.view", "customers.financials"), getInvoiceTemplates);
router.get("/items/by-sku-prefixes", requirePermission("packages.view", "billing.view"), getItemsBySkuPrefixes);
router.get("/items", requirePermission("packages.view", "billing.view"), getItems);
router.get("/customers", requirePermission("customers.financials"), getZohoCustomers);
router.get("/customer/:companyName", requirePermission("customers.financials"), getCustomerByCompanyName);
router.get("/invoices", requirePermission("billing.view", "customers.financials"), getInvoices);

module.exports = router;
