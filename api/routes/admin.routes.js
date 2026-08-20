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
  getActivityAudit,
  listUnifiedTransactions,
  exportUnifiedTransactions,
  getIntegrationEvent,
  getZohoCustomerPayment,
} = require("../controllers/admin.controller");
const {
  listUsers,
  createUser,
  updateUser,
  resetUserPassword,
  emailTemporaryPassword,
  impersonateUser,
} = require("../controllers/auth.controller");
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
  lookupCustomerByNumber,
  exportCustomers,
  getCustomer,
  previewShopCustomerNumber,
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
  createOnTisp,
  bulkCreateOnTisp,
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
const { attachPermissions, requirePermission, requireAdministrator } = require("../middleware/permissions");
const {
  listPermissionCatalog,
  listGroups,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  getUserEffectivePermissions,
  setUserPermissionOverrides,
  listPermissionAudit,
} = require("../controllers/rbac.controller");

const router = express.Router();

router.use(authenticate);
router.use(attachPermissions);

router.post(
  "/export/table",
  requirePermission("reports.export", "customers.export", "transactions.export"),
  exportTableReport
);

router.get("/stats", requirePermission("dashboard.finance"), getStats);
router.get("/support-stats", requirePermission("dashboard.support", "customers.view"), getSupportStats);
router.get("/partner/dashboard", requirePermission("dashboard.partner"), getPartnerDashboard);
router.get("/revenue-chart", requirePermission("dashboard.finance"), getRevenueChart);
router.get("/activity", requirePermission("dashboard.activity"), getActivityFeed);
router.get("/activity/audit", requireAdministrator, getActivityAudit);
router.get("/reports", requirePermission("reports.view"), listReports);
router.get("/reports/analytics", requirePermission("analytics.view", "reports.view"), getAnalytics);
router.get("/reports/kpis", requirePermission("analytics.view", "dashboard.finance"), getKpis);
router.get(
  "/reports/monthly-payment-churn/summary",
  requirePermission("reports.view"),
  getMonthlyPaymentChurnSummary
);
router.get(
  "/reports/invoices-vs-payments/summary",
  requirePermission("reports.view"),
  getInvoicesVsPaymentsSummary
);
router.get("/bi/dashboard", requirePermission("analytics.view"), getBiDashboard);
router.get("/bi/forecast", requirePermission("analytics.view"), getBiForecast);
router.get("/bi/export", requirePermission("analytics.export"), exportBiSection);
router.get("/reports/schedules", requirePermission("reports.schedule", "reports.view"), listReportSchedules);
router.post("/reports/schedules", requirePermission("reports.schedule"), createReportSchedule);
router.patch("/reports/schedules/:id", requirePermission("reports.schedule"), updateReportScheduleActive);
router.delete("/reports/schedules/:id", requirePermission("reports.schedule"), deleteReportSchedule);
router.post("/reports/schedules/:id/run", requirePermission("reports.schedule"), runReportSchedule);
router.get("/reports/schedules/:id/runs", requirePermission("reports.schedule", "reports.view"), listReportScheduleRuns);
router.get("/reports/:id/preview", requirePermission("reports.view"), previewReport);
router.get("/reports/:id/download", requirePermission("reports.export"), downloadReport);
router.get("/transactions", requirePermission("transactions.view"), listUnifiedTransactions);
router.get("/transactions/export", requirePermission("transactions.export"), exportUnifiedTransactions);
router.get("/transactions/integration/:id", requirePermission("transactions.view"), getIntegrationEvent);
router.get("/transactions/zoho-payment/:id", requirePermission("transactions.view"), getZohoCustomerPayment);
router.get("/transactions/mpesa/export", requirePermission("transactions.export"), exportMpesaTransactions);
router.get("/transactions/mpesa", requirePermission("transactions.view"), listMpesaTransactions);
router.get("/transactions/mpesa/:id", requirePermission("transactions.view"), getMpesaTransaction);
router.get("/transactions/zoho/export", requirePermission("transactions.export"), (req, res, next) => {
  req.params.source = "zoho";
  return exportIntegrationEvents(req, res, next);
});
router.get("/transactions/zoho", requirePermission("transactions.view"), listZohoEvents);
router.get("/transactions/tisp/export", requirePermission("transactions.export"), (req, res, next) => {
  req.params.source = "tisp";
  return exportIntegrationEvents(req, res, next);
});
router.get("/transactions/tisp", requirePermission("transactions.view"), listTispEvents);

router.get("/reconciliation/summary", requirePermission("billing.view"), getReconciliationSummary);
router.get("/reconciliation/sync-status", requirePermission("billing.view"), getReconciliationSyncStatus);
router.post("/reconciliation/sync", requirePermission("billing.sync"), runReconciliationSync);
router.get("/reconciliation/statuses", requirePermission("billing.view"), listReconciliationStatuses);
router.get("/reconciliation/unmatched-mpesa", requirePermission("billing.view"), listReconciliationUnmatchedMpesa);
router.get("/reconciliation/unmatched-mpesa/:id", requirePermission("billing.view"), getReconciliationUnmatchedMpesaDetail);
router.post("/reconciliation/unmatched-mpesa/:id/allocate", requirePermission("billing.allocate"), allocateReconciliationUnmatchedMpesa);
router.get("/reconciliation/export", requirePermission("billing.export"), exportReconciliation);
router.get("/reconciliation/customers", requirePermission("billing.view"), listReconciliationCustomers);
router.get("/reconciliation/customers/:id", requirePermission("billing.view"), getReconciliationCustomerDetail);
router.post("/reconciliation/customers/:id/actions", requirePermission("billing.actions"), executeReconciliationAction);
router.get("/reconciliation/communications/templates", requirePermission("billing.view"), getReconciliationCommunicationTemplates);

router.use("/sync", require("./sync.routes"));
router.get("/reconciliation/communications", requirePermission("billing.view"), listReconciliationCommunications);
router.get("/reconciliation/communications/:customerId/preview", requirePermission("billing.view"), previewReconciliationCommunication);
router.post("/reconciliation/communications/:customerId/send", requirePermission("billing.communicate"), sendReconciliationCommunication);
router.post("/reconciliation/communications/bulk-send", requirePermission("billing.communicate"), sendReconciliationBulkCommunications);

router.get("/logs", requirePermission("system_logs.view"), listLogs);
router.get("/logs/:id", requirePermission("system_logs.view"), getLog);
router.post("/logs/:id/retry", requirePermission("system_logs.retry"), retryLog);

router.get("/settings", requirePermission("settings.view", "users.view", "settings.sync"), getSettings);
router.put(
  "/settings/communication/email",
  requirePermission("communication.settings", "settings.edit"),
  updateCommunicationEmailSettings
);
router.put(
  "/settings/customer-email",
  requirePermission("communication.settings", "settings.edit"),
  updateCustomerEmailSettings
);
router.put(
  "/settings/communication/whatsapp",
  requirePermission("communication.settings", "settings.edit"),
  updateCommunicationWhatsAppSettings
);

router.get("/users", requirePermission("users.view"), listUsers);
router.post("/users", requirePermission("users.create"), createUser);
router.patch("/users/:id", requirePermission("users.edit"), updateUser);
router.post("/users/:id/reset-password", requirePermission("users.reset_password"), resetUserPassword);
router.post(
  "/users/:id/email-temporary-password",
  requirePermission("users.reset_password"),
  emailTemporaryPassword
);
router.post(
  "/users/:id/impersonate",
  requireAdministrator,
  impersonateUser
);

router.get("/rbac/catalog", requirePermission("users.view", "users.manage_permissions"), listPermissionCatalog);
router.get("/rbac/groups", requirePermission("users.view", "users.manage_groups"), listGroups);
router.get("/rbac/groups/:id", requirePermission("users.view", "users.manage_groups"), getGroup);
router.post("/rbac/groups", requirePermission("users.manage_groups"), createGroup);
router.patch("/rbac/groups/:id", requirePermission("users.manage_groups"), updateGroup);
router.delete("/rbac/groups/:id", requirePermission("users.manage_groups"), deleteGroup);
router.get("/rbac/users/:id/permissions", requirePermission("users.manage_permissions"), getUserEffectivePermissions);
router.put("/rbac/users/:id/permissions", requirePermission("users.manage_permissions"), setUserPermissionOverrides);
router.get("/rbac/audit", requirePermission("users.manage_permissions"), listPermissionAudit);

router.get("/pops", requirePermission("pops.view"), listPops);
router.post("/pops", requirePermission("pops.create"), createPop);
router.patch("/pops/:id", requirePermission("pops.edit"), updatePop);
router.get("/pops/:id/olts", requirePermission("pops.view"), listPopOlts);
router.post("/pops/:id/olts", requirePermission("pops.create"), createPopOlt);
router.patch("/pops/:id/olts/:oltId", requirePermission("pops.edit"), updatePopOlt);
router.delete("/pops/:id/olts/:oltId", requirePermission("pops.delete"), deletePopOlt);

router.get("/buildings", requirePermission("buildings.view"), listBuildings);
router.post("/buildings", requirePermission("buildings.create"), createBuilding);
router.patch("/buildings/:id", requirePermission("buildings.edit"), updateBuilding);
router.get("/buildings/:id/olts", requirePermission("buildings.view"), listBuildingOlts);
router.post("/buildings/:id/olts", requirePermission("buildings.create"), createBuildingOlt);
router.patch("/buildings/:id/olts/:oltId", requirePermission("buildings.edit"), updateBuildingOlt);
router.delete("/buildings/:id/olts/:oltId", requirePermission("buildings.delete"), deleteBuildingOlt);

router.get("/package-catalog", requirePermission("packages.view"), getPackageCatalog);
router.get("/products", requirePermission("packages.view"), listProducts);
router.post("/products", requirePermission("packages.create"), createProduct);
router.patch("/products/:id", requirePermission("packages.edit"), updateProduct);
router.delete("/products/:id", requirePermission("packages.delete"), deleteProduct);

router.get("/agencies", requirePermission("agencies.view"), listAgencies);
router.post("/agencies", requirePermission("agencies.create"), createAgency);
router.patch("/agencies/:id", requirePermission("agencies.edit"), updateAgency);
router.get("/agencies/:id", requirePermission("agencies.view"), getAgency);
router.get("/agencies/:id/invoices", requirePermission("agencies.view"), getAgencyInvoices);
router.post("/agencies/:id/invoices", requirePermission("agencies.create"), createAgencyInvoice);

const {
  listCampaigns,
  getActiveCampaign,
  getCampaign,
  getCampaignMetrics,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  runReferralMaintenance,
} = require("../controllers/campaigns.controller");

router.get("/campaigns", requirePermission("campaigns.view"), listCampaigns);
router.get(
  "/campaigns/active",
  requirePermission("customers.create", "campaigns.view"),
  getActiveCampaign
);
router.get(
  "/campaigns/:id/metrics",
  requirePermission("campaigns.view"),
  getCampaignMetrics
);
router.get("/campaigns/:id", requirePermission("campaigns.view"), getCampaign);
router.post("/campaigns", requireAdministrator, createCampaign);
router.patch("/campaigns/:id", requireAdministrator, updateCampaign);
router.delete("/campaigns/:id", requireAdministrator, deleteCampaign);
router.post(
  "/campaigns/referral-maintenance",
  requireAdministrator,
  runReferralMaintenance
);

const {
  listInstallations,
  listTechnicians: listInstallationTechnicians,
  getInstallation,
  assignInstallation,
  updateInstallation,
} = require("../controllers/installations.controller");

router.get("/installations", requirePermission("installations.view"), listInstallations);
router.get(
  "/installations/technicians",
  requirePermission(
    "installations.view",
    "installations.assign",
    "customers.create",
    "customers.edit"
  ),
  listInstallationTechnicians
);
router.get("/installations/:id", requirePermission("installations.view"), getInstallation);
router.post(
  "/installations/:id/assign",
  requirePermission("installations.assign"),
  assignInstallation
);
router.patch("/installations/:id", requirePermission("installations.edit"), updateInstallation);

const {
  listTypes: listActionTypes,
  listAssignees: listActionAssignees,
  listActionItems,
  getActionItem,
  createActionItem,
  updateActionItem,
  assignActionItem,
  updateStep: updateActionStep,
  addStep: addActionStep,
  listNotifications,
  unreadCount: notificationUnreadCount,
  markNotificationsRead,
  getVapidPublicKey,
  subscribePush,
  unsubscribePush,
} = require("../controllers/actionItems.controller");

router.get("/action-items/types", requirePermission("action_items.view", "action_items.create"), listActionTypes);
router.get(
  "/action-items/assignees",
  requirePermission("action_items.view", "action_items.create", "action_items.assign"),
  listActionAssignees
);
router.get("/action-items", requirePermission("action_items.view"), listActionItems);
router.get("/action-items/:id", requirePermission("action_items.view"), getActionItem);
router.post("/action-items", requirePermission("action_items.create"), createActionItem);
router.patch("/action-items/:id", requirePermission("action_items.edit"), updateActionItem);
router.post(
  "/action-items/:id/assign",
  requirePermission("action_items.assign", "action_items.edit"),
  assignActionItem
);
router.post("/action-items/:id/steps", requirePermission("action_items.edit"), addActionStep);
router.patch(
  "/action-items/:id/steps/:stepId",
  requirePermission("action_items.edit"),
  updateActionStep
);

router.get("/notifications", listNotifications);
router.get("/notifications/unread-count", notificationUnreadCount);
router.post("/notifications/read", markNotificationsRead);
router.get("/push/vapid-public-key", getVapidPublicKey);
router.post("/push/subscribe", subscribePush);
router.delete("/push/subscribe", unsubscribePush);

router.get("/apartments/history", requirePermission("apartments.view"), listApartmentHistoryRecords);
router.get("/apartments/check", requirePermission("apartments.view"), checkApartmentOccupancy);
router.get("/apartments", requirePermission("apartments.view"), listApartments);
router.get(
  "/apartments/:buildingId/:apartmentNumber/history",
  requirePermission("apartments.view"),
  getApartmentUnitHistory
);
router.get(
  "/apartments/:buildingId/:apartmentNumber",
  requirePermission("apartments.view"),
  getApartment
);

router.get("/customers/import/template", requirePermission("customers.import"), downloadImportTemplate);
router.post(
  "/customers/import",
  requirePermission("customers.import"),
  express.text({ type: "*/*", limit: "5mb" }),
  importCustomers
);
router.get("/customers", requirePermission("customers.view"), listCustomers);
router.get(
  "/customers/lookup",
  requirePermission("customers.view"),
  lookupCustomerByNumber
);
router.get("/customers/export", requirePermission("customers.export"), exportCustomers);
router.get(
  "/customers/shop-number-preview",
  requirePermission("customers.create"),
  previewShopCustomerNumber
);
router.post("/customers", requirePermission("customers.create"), createCustomer);
router.post("/customers/refresh-batch", requirePermission("customers.view"), refreshCustomersBatch);
router.patch("/customers/:id", requirePermission("customers.edit"), updateCustomer);
router.post("/customers/:id/convert-type", requirePermission("customers.edit"), convertCustomerType);
router.post("/customers/bulk-cancel", requirePermission("customers.cancel"), bulkCancelSubscriptions);
router.post("/customers/bulk-create-on-tisp", requirePermission("customers.edit"), bulkCreateOnTisp);
router.post("/customers/:id/create-on-tisp", requirePermission("customers.edit"), createOnTisp);
router.get("/customers/:id/transactions", requirePermission("customers.financials"), getCustomerTransactions);
router.get("/customers/:id/invoices", requirePermission("customers.financials"), getCustomerInvoices);
router.get("/customers/:id/payments", requirePermission("customers.financials"), getCustomerPayments);
router.post("/customers/:id/refresh", requirePermission("customers.edit"), refreshCustomerStatus);
router.post(
  "/customers/:id/retry-billing-onboarding",
  requirePermission("customers.edit"),
  retryBillingOnboarding
);
router.get("/customers/:id/upgrade-quote", requirePermission("customers.edit"), getUpgradeQuote);
router.get("/customers/:id/downgrade-quote", requirePermission("customers.edit"), getDowngradeQuote);
router.get("/customers/:id", requirePermission("customers.view"), getCustomer);
router.get("/customers/:id/integrations", requirePermission("customers.edit"), getCustomerIntegrations);
router.post("/customers/:id/upgrade", requirePermission("customers.edit"), upgradePackage);
router.post("/customers/:id/upgrade/cancel", requirePermission("customers.edit"), cancelPendingUpgrade);
router.post("/customers/:id/downgrade", requirePermission("customers.edit"), downgradePackage);
router.post(
  "/customers/:id/change-payment-frequency",
  requirePermission("customers.edit"),
  changePaymentFrequency
);
router.post("/customers/:id/switch-apartment", requirePermission("customers.edit"), switchApartment);
router.post("/customers/:id/cancel", requirePermission("customers.cancel"), cancelSubscription);
router.get("/olt/onu-list", requirePermission("customers.olt"), listOnus);
router.get("/olt/onu-ability", requirePermission("customers.olt"), getOnuAbility);
router.get("/customers/:id/olt-status", requirePermission("customers.olt"), getCustomerOltStatus);
router.post("/customers/:id/olt-link", requirePermission("customers.olt"), linkCustomerOlt);
router.post("/customers/:id/disconnect", requirePermission("customers.disconnect"), disconnectCustomer);
router.post("/customers/:id/pause", requirePermission("customers.pause"), pauseCustomer);
router.delete("/customers/:id", requirePermission("customers.delete"), deleteCustomerPermanently);
router.get(
  "/buildings/:buildingId/apartments/:apartmentNumber/history",
  requirePermission("apartments.view"),
  apartmentHistory
);

router.get("/leads/stats", requirePermission("leads.view"), getLeadStats);
router.get("/leads/whatsapp-by-phone", requirePermission("leads.view"), getWhatsAppLeadByPhone);
router.post("/leads/prospects", requirePermission("leads.create"), createProspect);
router.post("/leads/email-prospects", requirePermission("leads.create"), createEmailProspect);
router.post("/leads/whatsapp-send", requirePermission("leads.message"), sendWhatsAppToCustomer);
router.post("/leads/email-send", requirePermission("leads.message"), sendLeadEmail);
router.get("/leads", requirePermission("leads.view"), listLeads);
router.get("/leads/:id", requirePermission("leads.view"), getLead);
router.patch("/leads/:id", requirePermission("leads.edit"), updateLead);
router.post("/leads/:id/notes", requirePermission("leads.edit"), addLeadNote);
router.post("/leads/:id/whatsapp-reply", requirePermission("leads.message"), sendWhatsAppReply);
router.get("/leads/:id/email", requirePermission("leads.view"), listLeadEmailConversation);
router.post("/leads/:id/email", requirePermission("leads.message"), sendLeadEmail);

router.get("/communication/status", requirePermission("communication.view"), getChannelStatus);
router.get(
  "/communication/email/:customerId",
  requirePermission("communication.view"),
  listCustomerEmailConversation
);
router.post("/communication/email", requirePermission("communication.send"), sendCustomerEmail);
router.put(
  "/communication/email-settings",
  requirePermission("communication.settings"),
  updateCommunicationEmailSettings
);

module.exports = router;
