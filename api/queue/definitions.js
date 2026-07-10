const INTEGRATIONS = {
  CUSTOMER: "customers",
  ZOHO_CONTACTS: "zoho-contacts",
  INVOICE: "invoices",
  ZOHO_RECURRING: "zoho-recurring",
  ZOHO_PAYMENTS: "zoho-payments",
  PAYMENT: "payments",
  ZOHO_ESTIMATES: "zoho-estimates",
  ZOHO_CREDIT_NOTES: "zoho-credit-notes",
  RECONCILIATION: "reconciliation",
  PRODUCTS: "products",
};

const QUEUE_CONFIG = {
  [INTEGRATIONS.CUSTOMER]: {
    name: "customer-sync",
    dlqName: "customer-sync-dlq",
    defaultJobName: "sync-customers",
  },
  [INTEGRATIONS.ZOHO_CONTACTS]: {
    name: "zoho-contacts-sync",
    dlqName: "zoho-contacts-sync-dlq",
    defaultJobName: "sync-zoho-contacts",
  },
  [INTEGRATIONS.INVOICE]: {
    name: "invoice-sync",
    dlqName: "invoice-sync-dlq",
    defaultJobName: "sync-invoices",
  },
  [INTEGRATIONS.ZOHO_RECURRING]: {
    name: "zoho-recurring-sync",
    dlqName: "zoho-recurring-sync-dlq",
    defaultJobName: "sync-zoho-recurring",
  },
  [INTEGRATIONS.ZOHO_PAYMENTS]: {
    name: "zoho-payments-sync",
    dlqName: "zoho-payments-sync-dlq",
    defaultJobName: "sync-zoho-payments",
  },
  [INTEGRATIONS.PAYMENT]: {
    name: "payment-sync",
    dlqName: "payment-sync-dlq",
    defaultJobName: "sync-payments",
  },
  [INTEGRATIONS.ZOHO_ESTIMATES]: {
    name: "zoho-estimates-sync",
    dlqName: "zoho-estimates-sync-dlq",
    defaultJobName: "sync-zoho-estimates",
  },
  [INTEGRATIONS.ZOHO_CREDIT_NOTES]: {
    name: "zoho-credit-notes-sync",
    dlqName: "zoho-credit-notes-sync-dlq",
    defaultJobName: "sync-zoho-credit-notes",
  },
  [INTEGRATIONS.RECONCILIATION]: {
    name: "reconciliation-sync",
    dlqName: "reconciliation-sync-dlq",
    defaultJobName: "sync-reconciliation",
  },
  [INTEGRATIONS.PRODUCTS]: {
    name: "products-sync",
    dlqName: "products-sync-dlq",
    defaultJobName: "sync-products",
  },
};

const ALL_INTEGRATIONS = Object.values(INTEGRATIONS);

function getQueueConfig(integration) {
  const cfg = QUEUE_CONFIG[integration];
  if (!cfg) throw new Error(`Unknown integration queue: ${integration}`);
  return cfg;
}

module.exports = {
  INTEGRATIONS,
  QUEUE_CONFIG,
  ALL_INTEGRATIONS,
  getQueueConfig,
};
