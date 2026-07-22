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
const {
  requireAdmin,
  requireFinance,
  requireFinanceWrite,
  requireCustomerFinancialRead,
} = require("../middleware/rbac");

const router = express.Router();

router.get("/", requireAdmin, test);
router.post("/", requireFinanceWrite, createInvoice);
router.get("/invoice-templates", requireFinance, getInvoiceTemplates);
router.get("/items/by-sku-prefixes", requireFinance, getItemsBySkuPrefixes);
router.get("/items", requireFinance, getItems);
router.get("/customers", requireCustomerFinancialRead, getZohoCustomers);
router.get("/customer/:companyName", requireCustomerFinancialRead, getCustomerByCompanyName);
router.get("/invoices", requireFinance, getInvoices);

module.exports = router;
