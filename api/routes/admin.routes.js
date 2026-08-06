const express = require("express");
const {
  getStats,
  getSupportStats,
  getRevenueChart,
  listMpesaTransactions,
  getMpesaTransaction,
  listZohoEvents,
  listTispEvents,
  exportMpesaTransactions,
  exportIntegrationEvents,
  getActivityFeed,
  listUnifiedTransactions,
  exportUnifiedTransactions,
  getIntegrationEvent,
  getZohoCustomerPayment,
} = require("../controllers/admin.controller");
const { listUsers, createUser, updateUser, resetUserPassword } = require("../controllers/auth.controller");
const { listBuildings, createBuilding, updateBuilding, listBuildingOlts, createBuildingOlt, updateBuildingOlt, deleteBuildingOlt } = require("../controllers/buildings.controller");
const {
  listPops,
  createPop,
  updatePop,
  listPopOlts,
  createPopOlt,
  updatePopOlt,
  deletePopOlt,
} = require("../controllers/pops.controller");
const {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} = require("../controllers/products.controller");
const { getPackageCatalog } = require("../controllers/packageCatalog.controller");
const {
  listAgencies,
  createAgency,
  getAgency,
  getAgencyInvoices,
  createAgencyInvoice,
  updateAgency,
} = require("../controllers/agencies.controller");
const { listOnus, getOnuAbility, getCustomerOltStatus } = require("../controllers/olt.controller");
const {
  listCustomers,
  exportCustomers,
  getCustomer,
  getCustomerTransactions,
  getCustomerInvoices,
  getCustomerPayments,
  refreshCustomerStatus,
  refreshCustomersBatch,
  retryBillingOnboarding,
  getUpgradeQuote,
  getDowngradeQuote,
  createCustomer,
  updateCustomer,
  getCustomerIntegrations,
  convertCustomerType,
  upgradePackage,
  cancelPendingUpgrade,
  downgradePackage,
  changePaymentFrequency,
  switchApartment,
  cancelSubscription,
  disconnectCustomer,
  pauseCustomer,
  linkCustomerOlt,
  deleteCustomerPermanently,
  apartmentHistory,
  downloadImportTemplate,
  importCustomers,
  bulkCancelSubscriptions,
} = require("../controllers/customers.controller");
const {
  listLogs,
  getLog,
  retryLog,
} = require("../controllers/logs.controller");
const {
  listReports,
  previewReport,
  downloadReport,
  getAnalytics,
  getKpis,
  getMonthlyPaymentChurnSummaryHandler: getMonthlyPaymentChurnSummary,
  getInvoicesVsPaymentsSummaryHandler: getInvoicesVsPaymentsSummary,
} = require("../controllers/reports.controller");
const { getDashboard: getBiDashboard, getForecast: getBiForecast, exportSection: exportBiSection } = require("../controllers/bi.controller");
const {
  listReportSchedules,
  createReportSchedule,
  updateReportScheduleActive,
  deleteReportSchedule,
  runReportSchedule,
  listReportScheduleRuns,
} = require("../controllers/reportSchedules.controller");
const { exportTableReport } = require("../controllers/tableExport.controller");
const { getSettings } = require("../controllers/settings.controller");
const {
  getSummary: getReconciliationSummary,
  getSyncStatus: getReconciliationSyncStatus,
  runSync: runReconciliationSync,
  listCustomers: listReconciliationCustomers,
  getCustomerDetail: getReconciliationCustomerDetail,
  listUnmatchedMpesa: listReconciliationUnmatchedMpesa,
  getUnmatchedMpesaDetail: getReconciliationUnmatchedMpesaDetail,
  allocateUnmatchedMpesa: allocateReconciliationUnmatchedMpesa,
  executeAction: executeReconciliationAction,
  exportReconciliation,
  listStatuses: listReconciliationStatuses,
  listCommunications: listReconciliationCommunications,
  previewCommunication: previewReconciliationCommunication,
  sendCommunication: sendReconciliationCommunication,
  sendBulkCommunications: sendReconciliationBulkCommunications,
  getCommunicationTemplates: getReconciliationCommunicationTemplates,
} = require("../controllers/reconciliation.controller");
const { getDashboard: getPartnerDashboard } = require("../controllers/partner.controller");
const {
  listApartmentHistoryRecords,
  listApartments,
  getApartment,
  getApartmentUnitHistory,
  checkApartmentOccupancy,
} = require("../controllers/apartments.controller");
const {
  listLeads,
  getLeadStats,
  getLead,
  createProspect,
  createEmailProspect,
  getWhatsAppLeadByPhone,
  updateLead,
  addLeadNote,
  sendWhatsAppReply,
  sendWhatsAppToCustomer,
  listLeadEmailConversation,
  sendLeadEmail,
} = require("../controllers/leads.controller");
const {
  getChannelStatus,
  listCustomerEmailConversation,
  sendCustomerEmail,
  updateCommunicationEmailSettings,
  updateCustomerEmailSettings,
  updateCommunicationWhatsAppSettings,
} = require("../controllers/communication.controller");

const { authenticate } = require("../middleware/auth");
const {
  requireAdmin,
  requireFinance,
  requireFinanceWrite,
  requireCustomerRead,
  requireCustomerWrite,
  requireCustomerFinancialRead,
  requireAgencyWrite,
  requireConfigRead,
  requireConfigWrite,
  requireOps,
  requirePartnerDashboard,
  requireReportsAccess,
} = require("../middleware/rbac");

const router = express.Router();

router.use(authenticate);

router.post("/export/table", exportTableReport);

router.get("/stats", requireFinance, getStats);
router.get("/support-stats", requireCustomerRead, getSupportStats);
router.get("/partner/dashboard", requirePartnerDashboard, getPartnerDashboard);
router.get("/revenue-chart", requireFinance, getRevenueChart);
router.get("/activity", requireFinance, getActivityFeed);
router.get("/reports", requireReportsAccess, listReports);
router.get("/reports/analytics", requireFinance, getAnalytics);
router.get("/reports/kpis", requireFinance, getKpis);
router.get(
  "/reports/monthly-payment-churn/summary",
  requireReportsAccess,
  getMonthlyPaymentChurnSummary
);
router.get(
  "/reports/invoices-vs-payments/summary",
  requireReportsAccess,
  getInvoicesVsPaymentsSummary
);
router.get("/bi/dashboard", requireFinance, getBiDashboard);
router.get("/bi/forecast", requireFinance, getBiForecast);
router.get("/bi/export", requireFinance, exportBiSection);
router.get("/reports/schedules", requireReportsAccess, listReportSchedules);
router.post("/reports/schedules", requireReportsAccess, createReportSchedule);
router.patch("/reports/schedules/:id", requireReportsAccess, updateReportScheduleActive);
router.delete("/reports/schedules/:id", requireReportsAccess, deleteReportSchedule);
router.post("/reports/schedules/:id/run", requireReportsAccess, runReportSchedule);
router.get("/reports/schedules/:id/runs", requireReportsAccess, listReportScheduleRuns);
router.get("/reports/:id/preview", requireReportsAccess, previewReport);
router.get("/reports/:id/download", requireReportsAccess, downloadReport);
router.get("/transactions", requireFinance, listUnifiedTransactions);
router.get("/transactions/export", requireFinance, exportUnifiedTransactions);
router.get("/transactions/integration/:id", requireFinance, getIntegrationEvent);
router.get("/transactions/zoho-payment/:id", requireFinance, getZohoCustomerPayment);
router.get("/transactions/mpesa/export", requireFinance, exportMpesaTransactions);
router.get("/transactions/mpesa", requireFinance, listMpesaTransactions);
router.get("/transactions/mpesa/:id", requireFinance, getMpesaTransaction);
router.get("/transactions/zoho/export", requireFinance, (req, res, next) => {
  req.params.source = "zoho";
  return exportIntegrationEvents(req, res, next);
});
router.get("/transactions/zoho", requireFinance, listZohoEvents);
router.get("/transactions/tisp/export", requireFinance, (req, res, next) => {
  req.params.source = "tisp";
  return exportIntegrationEvents(req, res, next);
});
router.get("/transactions/tisp", requireFinance, listTispEvents);

router.get("/reconciliation/summary", requireFinance, getReconciliationSummary);
router.get("/reconciliation/sync-status", requireFinance, getReconciliationSyncStatus);
router.post("/reconciliation/sync", requireFinanceWrite, runReconciliationSync);
router.get("/reconciliation/statuses", requireFinance, listReconciliationStatuses);
router.get("/reconciliation/unmatched-mpesa", requireFinance, listReconciliationUnmatchedMpesa);
router.get("/reconciliation/unmatched-mpesa/:id", requireFinance, getReconciliationUnmatchedMpesaDetail);
router.post("/reconciliation/unmatched-mpesa/:id/allocate", requireFinanceWrite, allocateReconciliationUnmatchedMpesa);
router.get("/reconciliation/export", requireFinance, exportReconciliation);
router.get("/reconciliation/customers", requireFinance, listReconciliationCustomers);
router.get("/reconciliation/customers/:id", requireFinance, getReconciliationCustomerDetail);
router.post("/reconciliation/customers/:id/actions", requireFinanceWrite, executeReconciliationAction);
router.get("/reconciliation/communications/templates", requireFinance, getReconciliationCommunicationTemplates);

router.use("/sync", require("./sync.routes"));
router.get("/reconciliation/communications", requireFinance, listReconciliationCommunications);
router.get("/reconciliation/communications/:customerId/preview", requireFinance, previewReconciliationCommunication);
router.post("/reconciliation/communications/:customerId/send", requireFinanceWrite, sendReconciliationCommunication);
router.post("/reconciliation/communications/bulk-send", requireFinanceWrite, sendReconciliationBulkCommunications);

router.get("/logs", requireOps, listLogs);
router.get("/logs/:id", requireOps, getLog);
router.post("/logs/:id/retry", requireOps, retryLog);

router.get("/settings", requireAdmin, getSettings);
router.put(
  "/settings/communication/email",
  requireAdmin,
  updateCommunicationEmailSettings
);
router.put(
  "/settings/customer-email",
  requireAdmin,
  updateCustomerEmailSettings
);
router.put(
  "/settings/communication/whatsapp",
  requireAdmin,
  updateCommunicationWhatsAppSettings
);

router.get("/users", requireAdmin, listUsers);
router.post("/users", requireAdmin, createUser);
router.patch("/users/:id", requireAdmin, updateUser);
router.post("/users/:id/reset-password", requireAdmin, resetUserPassword);

router.get("/pops", requireConfigRead, listPops);
router.post("/pops", requireConfigWrite, createPop);
router.patch("/pops/:id", requireConfigWrite, updatePop);
router.get("/pops/:id/olts", requireConfigRead, listPopOlts);
router.post("/pops/:id/olts", requireConfigWrite, createPopOlt);
router.patch("/pops/:id/olts/:oltId", requireConfigWrite, updatePopOlt);
router.delete("/pops/:id/olts/:oltId", requireConfigWrite, deletePopOlt);

router.get("/buildings", requireConfigRead, listBuildings);
router.post("/buildings", requireConfigWrite, createBuilding);
router.patch("/buildings/:id", requireConfigWrite, updateBuilding);
router.get("/buildings/:id/olts", requireConfigRead, listBuildingOlts);
router.post("/buildings/:id/olts", requireConfigWrite, createBuildingOlt);
router.patch("/buildings/:id/olts/:oltId", requireConfigWrite, updateBuildingOlt);
router.delete("/buildings/:id/olts/:oltId", requireConfigWrite, deleteBuildingOlt);

router.get("/package-catalog", requireConfigRead, getPackageCatalog);
router.get("/products", requireConfigRead, listProducts);
router.post("/products", requireConfigWrite, createProduct);
router.patch("/products/:id", requireConfigWrite, updateProduct);
router.delete("/products/:id", requireConfigWrite, deleteProduct);

router.get("/agencies", requireConfigRead, listAgencies);
router.post("/agencies", requireAgencyWrite, createAgency);
router.patch("/agencies/:id", requireAgencyWrite, updateAgency);
router.get("/agencies/:id", requireConfigRead, getAgency);
router.get("/agencies/:id/invoices", requireConfigRead, getAgencyInvoices);
router.post("/agencies/:id/invoices", requireAgencyWrite, createAgencyInvoice);

router.get("/apartments/history", requireConfigRead, listApartmentHistoryRecords);
router.get("/apartments/check", requireConfigRead, checkApartmentOccupancy);
router.get("/apartments", requireConfigRead, listApartments);
router.get(
  "/apartments/:buildingId/:apartmentNumber/history",
  requireConfigRead,
  getApartmentUnitHistory
);
router.get(
  "/apartments/:buildingId/:apartmentNumber",
  requireConfigRead,
  getApartment
);

router.get("/customers/import/template", requireCustomerWrite, downloadImportTemplate);
router.post(
  "/customers/import",
  requireCustomerWrite,
  express.text({ type: "*/*", limit: "5mb" }),
  importCustomers
);
router.get("/customers", requireCustomerRead, listCustomers);
router.get("/customers/export", requireCustomerRead, exportCustomers);
router.post("/customers", requireCustomerWrite, createCustomer);
router.post("/customers/refresh-batch", requireCustomerRead, refreshCustomersBatch);
router.patch("/customers/:id", requireCustomerWrite, updateCustomer);
router.post("/customers/:id/convert-type", requireCustomerWrite, convertCustomerType);
router.post("/customers/bulk-cancel", requireCustomerWrite, bulkCancelSubscriptions);
router.get("/customers/:id/transactions", requireCustomerFinancialRead, getCustomerTransactions);
router.get("/customers/:id/invoices", requireCustomerFinancialRead, getCustomerInvoices);
router.get("/customers/:id/payments", requireCustomerFinancialRead, getCustomerPayments);
router.post("/customers/:id/refresh", requireCustomerWrite, refreshCustomerStatus);
router.post(
  "/customers/:id/retry-billing-onboarding",
  requireCustomerWrite,
  retryBillingOnboarding
);
router.get("/customers/:id/upgrade-quote", requireCustomerWrite, getUpgradeQuote);
router.get("/customers/:id/downgrade-quote", requireCustomerWrite, getDowngradeQuote);
router.get("/customers/:id", requireCustomerRead, getCustomer);
router.get("/customers/:id/integrations", requireCustomerWrite, getCustomerIntegrations);
router.post("/customers/:id/upgrade", requireCustomerWrite, upgradePackage);
router.post("/customers/:id/upgrade/cancel", requireCustomerWrite, cancelPendingUpgrade);
router.post("/customers/:id/downgrade", requireCustomerWrite, downgradePackage);
router.post(
  "/customers/:id/change-payment-frequency",
  requireCustomerWrite,
  changePaymentFrequency
);
router.post("/customers/:id/switch-apartment", requireCustomerWrite, switchApartment);
router.post("/customers/:id/cancel", requireCustomerWrite, cancelSubscription);
router.get("/olt/onu-list", requireCustomerRead, listOnus);
router.get("/olt/onu-ability", requireCustomerRead, getOnuAbility);
router.get("/customers/:id/olt-status", requireCustomerRead, getCustomerOltStatus);
router.post("/customers/:id/olt-link", requireCustomerWrite, linkCustomerOlt);
router.post("/customers/:id/disconnect", requireCustomerWrite, disconnectCustomer);
router.post("/customers/:id/pause", requireCustomerWrite, pauseCustomer);
router.delete("/customers/:id", requireAdmin, deleteCustomerPermanently);
router.get(
  "/buildings/:buildingId/apartments/:apartmentNumber/history",
  requireConfigRead,
  apartmentHistory
);

router.get("/leads/stats", requireCustomerRead, getLeadStats);
router.get("/leads/whatsapp-by-phone", requireCustomerRead, getWhatsAppLeadByPhone);
router.post("/leads/prospects", requireCustomerWrite, createProspect);
router.post("/leads/email-prospects", requireCustomerWrite, createEmailProspect);
router.post("/leads/whatsapp-send", requireCustomerWrite, sendWhatsAppToCustomer);
router.post("/leads/email-send", requireCustomerWrite, sendLeadEmail);
router.get("/leads", requireCustomerRead, listLeads);
router.get("/leads/:id", requireCustomerRead, getLead);
router.patch("/leads/:id", requireCustomerWrite, updateLead);
router.post("/leads/:id/notes", requireCustomerWrite, addLeadNote);
router.post("/leads/:id/whatsapp-reply", requireCustomerWrite, sendWhatsAppReply);
router.get("/leads/:id/email", requireCustomerRead, listLeadEmailConversation);
router.post("/leads/:id/email", requireCustomerWrite, sendLeadEmail);

router.get("/communication/status", requireCustomerRead, getChannelStatus);
router.get(
  "/communication/email/:customerId",
  requireCustomerRead,
  listCustomerEmailConversation
);
router.post("/communication/email", requireCustomerWrite, sendCustomerEmail);
router.put(
  "/communication/email-settings",
  requireAdmin,
  updateCommunicationEmailSettings
);

module.exports = router;
