const API_BASE = "/api";

type AuthSessionExpiredHandler = () => void;
let authSessionExpiredHandler: AuthSessionExpiredHandler | null = null;
let authSessionExpiredNotified = false;

/** Called by AuthProvider — clears user and sends to login on any 401. */
export function registerAuthSessionExpiredHandler(handler: AuthSessionExpiredHandler | null) {
  authSessionExpiredHandler = handler;
}

export function resetAuthSessionExpiredFlag() {
  authSessionExpiredNotified = false;
}

function notifyAuthSessionExpired(path: string) {
  if (authSessionExpiredNotified) return;
  if (path.startsWith("/auth/login")) return;
  authSessionExpiredNotified = true;
  authSessionExpiredHandler?.();
}

function rejectApiResponse(res: Response, body: Record<string, unknown>, path: string): never {
  if (res.status === 401) {
    notifyAuthSessionExpired(path);
  }
  const message =
    (typeof body.error === "string" && body.error) ||
    (typeof body.message === "string" && body.message) ||
    `Request failed (${res.status})`;
  throw new Error(message);
}

export type User = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "support" | "cfo" | "viewer" | "partner" | "ceo";
};

export type AdminUser = User & {
  is_active: number;
  created_at: string;
};

export type Building = {
  id: number;
  name: string;
  c2bCode: string;
  b2bCode: string;
  ipSetup: "STATIC" | "PPOE";
  dstvSetup: "headend_coax" | "decoder";
  ipPrefixes: string[];
  createdAt?: string;
};

export type Product = {
  id: number;
  planVariantId: number | null;
  name: string;
  mbps: number;
  extraBandwidth?: number;
  paymentFrequency: "monthly" | "quarterly" | "yearly";
  hasDstv: number;
  buildingId: number;
  buildingName: string;
  price: number;
  monthlyPrice: number;
  isActive: number;
  createdAt: string;
  categoryId?: number | null;
  categoryCode?: string | null;
  categoryName?: string | null;
  planId?: number | null;
  planCode?: string | null;
  planName?: string | null;
  planSortOrder?: number | null;
  requiresDecoderFee?: number | null;
  decoderFeeAmount?: number | null;
};

export type PackagePlanVariant = {
  id: number;
  planId: number;
  paymentFrequency: "monthly" | "quarterly" | "yearly";
  defaultMbps: number;
};

export type PackagePlan = {
  id: number;
  categoryId: number;
  code: string;
  name: string;
  sortOrder: number;
  variants: PackagePlanVariant[];
};

export type PackageCategory = {
  id: number;
  code: string;
  name: string;
  hasApartonet: boolean;
  hasDstv: boolean;
  requiresDecoderFee: boolean;
  decoderFeeAmount: number | null;
  sortOrder: number;
  plans: PackagePlan[];
};

export type Agency = {
  id: number;
  name: string;
  email: string;
  phone: string;
  contactPerson: string | null;
  createdAt: string;
  activeCustomers?: number;
};

export type AgencyBilling = {
  totalCustomers: number;
  activeCustomers: number;
  cancelledCustomers: number;
  totalActiveAmount: number;
};

export type AgencyInvoiceDiscount = {
  type: "percent" | "amount";
  value: number;
};

export type AgencyInvoicePayload = {
  mode: "consolidated" | "customer";
  customerId?: number;
  discount?: AgencyInvoiceDiscount;
};

export type AgencyZohoStatus = {
  linked: boolean;
  zohoContactId: string | null;
  invoiceCount: number;
  unpaidCount: number;
  totalBalanceDue: number;
  zohoError?: string;
};

export type ApiCallLog = {
  id: number;
  service: "tisp" | "zoho" | "mpesa" | "other";
  operation: string;
  method: string;
  endpoint: string;
  status: "success" | "failure";
  httpStatus: number | null;
  requestPayload: Record<string, unknown>;
  responsePayload: unknown;
  errorMessage: string | null;
  customerId: number | null;
  customerNumber: string | null;
  referenceId: string | null;
  retryable: boolean;
  retryCount: number;
  parentLogId: number | null;
  createdAt: string;
};

export type AppSettings = {
  webhooks: {
    mpesa: {
      callback: string;
      confirmation: string;
      validation: string;
      b2cResult: string;
      b2cTimeout: string;
    };
    zoho: {
      invoicePaid: string;
      secretConfigured: boolean;
    };
  };
  integrations: {
    xtreamSyncEnabled: boolean;
    mpesaStkLiveAmount: boolean;
    zohoTaxInclusive: boolean;
  };
  roles: Array<{
    id: string;
    label: string;
    description: string;
  }>;
};

export type Customer = {
  id: number;
  firstName: string;
  middleName: string | null;
  lastName: string;
  fullName: string;
  phone: string;
  email: string | null;
  ipAddress: string | null;
  isVatExempt: boolean;
  customerType: "C2B" | "B2B";
  apartmentNumber: string;
  paymentFrequency: "monthly" | "quarterly" | "yearly" | "custom";
  customPeriodDays: number | null;
  buildingId: number;
  buildingName: string;
  productId: number;
  productName: string;
  productMbps: number;
  planId?: number | null;
  planName?: string | null;
  planSortOrder?: number | null;
  agencyId: number | null;
  agencyName: string | null;
  customerNumber: string;
  packagePrice: number;
  decoderFeeAmount: number | null;
  decoderFeeRequired: boolean;
  hasDstv: boolean;
  dstvDecoderSerial: string | null;
  dstvSerialMissing: boolean;
  subscriptionStatus: string | null;
  tispSyncStatus: "pending" | "synced" | "failed";
  tispSyncError: string | null;
  zohoBillingStatus: "pending" | "completed" | "failed";
  zohoBillingError: string | null;
  zohoSignupInvoiceId?: string | null;
  zohoSignupInvoiceEmailedAt?: string | null;
  trialPeriodEnabled: boolean;
  trialEndsAt: string | null;
  lastPaymentDate: string | null;
  tispDueDate: string | null;
  status: "active" | "cancelled";
  upgradePaymentStatus?: "none" | "payment_pending";
  createdAt: string;
  updatedAt: string;
};

export type UpgradePaymentMethod = "invoice" | "stk";

export type UpgradeQuote = {
  topUpAmount: number;
  currentPrice: number;
  newPrice: number;
  priceDifference: number;
  remainingCredit?: number;
  creditAmount?: number;
  dueDate: string | null;
  subscriptionStatus: string | null;
  isActive: boolean;
  periodDays: number;
  currentPeriodDays?: number;
  daysUntilDue: number | null;
  daysRemainingInPeriod: number | null;
  frequencyChanged?: boolean;
  recommendedPaymentMethod: UpgradePaymentMethod | "none";
  explanation: string;
  paymentRequired: boolean;
  customerNumber: string;
  currentMbps: number;
  newMbps: number;
  newProductName: string;
  paymentFrequency: string;
  customPeriodDays: number | null;
};

export type PendingUpgrade = {
  id: number;
  customerId: number;
  targetProductId: number;
  paymentMethod: UpgradePaymentMethod;
  topUpAmount: number;
  status: "payment_pending" | "completed" | "cancelled" | "failed";
  zohoInvoiceId: string | null;
  zohoInvoiceNumber: string | null;
  mpesaCheckoutRequestId: string | null;
  quote: UpgradeQuote | null;
  targetProductMbps: number | null;
  targetProductName: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type CustomerEvent = {
  id: number;
  eventType: string;
  oldApartment: string | null;
  newApartment: string | null;
  notes: string | null;
  createdAt: string;
  oldProductName: string | null;
  newProductName: string | null;
};

export type CustomerPayment = {
  id: string;
  source: "mpesa" | "zoho";
  amount: number | null;
  referenceId: string | null;
  phone: string | null;
  channel: string | null;
  status: string;
  invoiceNumber: string | null;
  paidAt: string;
};

export type ZohoInvoice = {
  id: string;
  invoiceNumber: string | null;
  orderNumber: string | null;
  date: string | null;
  dueDate: string | null;
  status: string;
  total: number | null;
  balanceDue: number | null;
  currency: string;
};

export type CustomerZohoStatus = {
  linked: boolean;
  zohoContactId: string | null;
  invoices: ZohoInvoice[];
  invoiceCount: number;
  unpaidCount: number;
  totalBalanceDue: number;
  /** Zoho unused credit / overpayment on the contact (KES). */
  creditBalance?: number;
  billedViaAgency?: boolean;
  agencyId?: number | null;
  agencyName?: string | null;
  billingNote?: string | null;
  lastSyncedAt?: string | null;
  fromSnapshot?: boolean;
  cacheFresh?: boolean;
};

export type ZohoApiUsageReport = {
  day: string;
  hour: string;
  dailyLimit: number;
  used: number;
  remaining: number;
  hourly: number;
  percentUsed: number;
  alert: { level: string; threshold: number };
  thresholds: { warning: number; critical: number; emergency: number };
  byModule: Record<string, number>;
  bySource: Record<string, number>;
};

export type ApartmentHistoryEntry = {
  id: number;
  buildingId: number;
  buildingName: string;
  apartmentNumber: string;
  customerId: number;
  customerNumber: string;
  customerName: string;
  movedInAt: string;
  movedOutAt: string | null;
  reason: "signup" | "switch_in" | "switch_out" | "cancel" | string;
  customerStatus: "active" | "cancelled";
  isCurrent: boolean;
  phone: string | null;
  email: string | null;
  customerType: "C2B" | "B2B";
  paymentFrequency: "monthly" | "quarterly" | "yearly" | "custom";
  customPeriodDays: number | null;
  packagePrice: number | null;
  lastPaymentDate: string | null;
  subscriptionStatus: string | null;
  productName: string | null;
  productMbps: number | null;
};

export type ApartmentOccupancy = {
  available: boolean;
  tenant: {
    id: number;
    customerNumber: string;
    customerName: string;
    apartmentNumber: string;
  } | null;
};

export type CustomerImportEvent = {
  type:
    | "start"
    | "row_start"
    | "progress"
    | "row_done"
    | "row_error"
    | "complete";
  line?: number;
  index?: number;
  total?: number;
  step?: string;
  message?: string;
  customerNumber?: string;
  ok?: boolean;
  error?: string;
  succeeded?: number;
  failed?: number;
  tispOk?: boolean;
  tispError?: string | null;
  zohoOk?: boolean;
  zohoError?: string | null;
  zohoLinked?: boolean;
};

export type MpesaTransaction = {
  id: number;
  checkoutRequestId: string | null;
  mpesaReceipt: string | null;
  phone: string | null;
  amount: number | null;
  accountReference: string | null;
  status: "PENDING" | "SUCCESS" | "FAILED";
  resultDesc: string | null;
  channel: string | null;
  createdAt: string;
};

export type IntegrationEvent = {
  id: number;
  source: "zoho" | "tisp";
  status: string;
  customerNo: string | null;
  amount: number | null;
  referenceId: string | null;
  outcome: string | null;
  channel: string | null;
  checkoutRequestId?: string | null;
  mpesaReceipt?: string | null;
  phone?: string | null;
  createdAt: string;
};

export type UnifiedTransaction = {
  id: number;
  source: "mpesa" | "zoho" | "tisp";
  status: string;
  amount: number | null;
  customerRef: string | null;
  phone: string | null;
  referenceId: string | null;
  channel: string | null;
  checkoutRequestId: string | null;
  detail: string | null;
  outcome: string | null;
  zohoAction?: "created" | "updated" | null;
  createdAt: string;
};

export type MpesaTransactionDetail = {
  transaction: MpesaTransaction;
  integrations: Array<{
    id: number;
    source: string;
    status: string;
    outcome: string | null;
    createdAt: string;
  }>;
};

export type IntegrationEventDetail = {
  id: number;
  source: "zoho" | "tisp";
  status: string;
  customerNo: string | null;
  amount: number | null;
  referenceId: string | null;
  outcome: string | null;
  channel: string | null;
  checkoutRequestId: string | null;
  mpesaReceipt: string | null;
  phone: string | null;
  accountReference: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type ActivityItem = {
  id: number;
  eventType: string;
  title: string;
  message: string | null;
  source: "mpesa" | "zoho" | "tisp";
  status: "success" | "failed" | "pending";
  customerRef: string | null;
  amount: number | null;
  referenceId: string | null;
  createdAt: string;
};

export type ReconciliationRecommendation = {
  action: string;
  label: string;
  detail: string | null;
};

export type ReconciliationMetrics = {
  expectedAmount: number;
  monthlyPrice: number | null;
  amountPaid: number;
  outstandingBalance: number;
  creditBalance: number;
  billingFrequency: string;
  customPeriodDays: number | null;
  subscriptionStatus: string;
  tispDueDate?: string | null;
  lastInvoiceDate?: string | null;
  lastPaymentDate?: string | null;
  accountStatus?: string | null;
  serviceActive: boolean;
  serviceDisconnected?: boolean;
  overdueCount: number;
  unpaidInvoiceCount: number;
  unmatchedMpesaCount: number;
  recurringInvoiceActive: boolean;
  zohoLinked?: boolean;
  revenueAtRisk: number;
};

export type ReconciliationCustomerRow = {
  customerId: number;
  customerNumber: string;
  customerName: string;
  buildingName: string | null;
  productName: string | null;
  customerType?: "C2B" | "B2B";
  primaryStatus: string;
  statuses: string[];
  metrics: ReconciliationMetrics;
  recommendations: ReconciliationRecommendation[];
  issueBasis: string | null;
  actionLabel: string | null;
  syncedAt: string;
};

export type ReconciliationIssueCustomer = {
  customerId: number | null;
  customerNumber: string;
  customerName: string;
  buildingName: string | null;
  productName: string | null;
  outstandingBalance: number;
  expectedAmount: number;
  amountPaid: number;
  billingFrequency: string | null;
  subscriptionStatus: string | null;
  actionLabel: string | null;
  issueBasis: string | null;
  primaryStatus: string;
  mpesaPaymentId?: number;
};

export type ReconciliationIssueTile = {
  id: string;
  label: string;
  severity: "critical" | "high" | "medium" | "low";
  count: number;
  customers: ReconciliationIssueCustomer[];
};

export type ReconciliationSyncProgress = {
  phase: string;
  processed: number;
  total: number;
  issuesFound: number;
  partialReady: boolean;
};

export type ReconciliationSummary = {
  connectedWithoutPayment: number;
  paidButDisconnected: number;
  overdueCustomers: number;
  partialPayments: number;
  unmatchedMpesaPayments: number;
  recurringInvoicesStopped: number;
  missingInvoices: number;
  billingGaps?: number;
  disconnectedNotInvoiced: number;
  communicationsEligible?: number;
  communicationsTotal?: number;
  manualReviewsRequired: number;
  paymentUnderReview?: number;
  cancelledStillActive?: number;
  staleBilling?: number;
  noZohoLink?: number;
  revenueAtRisk: number;
  totalOutstandingBalance: number;
  expectedRevenueThisMonth: number;
  revenueCollectedThisMonth: number;
  collectionRate: number;
  issueTiles: ReconciliationIssueTile[];
  fromCache?: boolean;
  cacheUpdatedAt?: string | null;
  cachePartial?: boolean;
  sync: {
    status: string;
    lastSyncAt: string | null;
    lastError: string | null;
    customerCount: number;
    issueCustomerCount?: number;
    fullZohoReady?: boolean;
    progress?: ReconciliationSyncProgress;
  };
  mailConfig?: {
    configured: boolean;
    fromAddress: string | null;
    fromName: string;
    accountId: string | null;
  };
};

export type BillingCommunicationCandidate = {
  customerId: number;
  customerNumber: string;
  customerName: string;
  primaryStatus: string;
  statuses: string[];
  outstandingBalance: number;
  expectedAmount: number;
  subscriptionStatus: string | null;
  issueBasis: string | null;
  email: string | null;
  emailSource: string | null;
  canSend: boolean;
  templateKey: string | null;
  templateLabel: string | null;
  lastSentAt: string | null;
  sendCount: number;
};

export type BillingCommunicationPreview = {
  customerId: number;
  customerNumber: string;
  customerName: string;
  email: string | null;
  emailSource: string | null;
  canSend: boolean;
  templateKey: string;
  templateLabel: string;
  subject: string;
  html: string;
  text: string;
  mailConfig?: ReconciliationSummary["mailConfig"];
};

export type ReconciliationSyncStatus = {
  status: string;
  lastSyncAt: string | null;
  lastError: string | null;
  runId: number | null;
  intervalMs: number;
  customerCount: number;
  unmatchedMpesaCount: number;
};

export type SyncJobRow = {
  id: number;
  integration: string;
  jobId: string | null;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  lastError: string | null;
  lastSyncedAt: string | null;
  correlationId: string | null;
  createdAt: string;
};

export type SyncIntegrationState = {
  integration: string;
  status?: string;
  lastSyncedAt: string | null;
  lastAttemptAt?: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  recordsUpdated?: number;
  syncCursor?: Record<string, unknown> | null;
  updatedAt: string;
};

export type SyncQueueStats = {
  integration: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
};

export type SyncIntegrationStatus = {
  integration: string;
  label: string;
  intervalMs: number | null;
  state: SyncIntegrationState | null;
  queue: SyncQueueStats | null;
};

export type SyncOverview = {
  syncEnabled: boolean;
  redisConnected: boolean;
  zohoBudget?: ZohoBudgetStatus;
  apiUsage?: ZohoApiUsageReport | null;
  zohoSyncPolicy?: {
    mode: string;
    scheduledModules: string[];
    incrementalLookbackDays: number;
    fullReconciliationScheduled: boolean;
    backgroundSyncEnabled: boolean;
    syncIntervalMs: number;
  };
  integrations: SyncIntegrationStatus[];
  runningJobs: SyncJobRow[];
};

export type ZohoBudgetStatus = {
  enabled: boolean;
  day: string;
  dailyLimit: number;
  reserve: number;
  backgroundLimit: number;
  used: number;
  remaining: number;
  backgroundRemaining: number;
  percentUsed: number;
  resetsAtUtc: string;
};

export type SyncProgressEvent = {
  integration: string;
  correlationId?: string;
  syncJobDbId?: number;
  jobId?: string;
  status?: string;
  event?: string;
  error?: string;
  progress?: {
    processed: number;
    total: number;
    percent: number;
    created?: number;
    updated?: number;
    failed?: number;
    phase?: string;
  };
};

export type UnmatchedMpesaPayment = {
  id: number;
  amount: number | null;
  referenceId: string | null;
  phone: string | null;
  accountReference: string | null;
  channel: string | null;
  paidAt: string;
  suggestedCustomerNumber: string | null;
  customerId?: number | null;
  customerName?: string | null;
};

export type UnmatchedMpesaDetail = {
  payment: UnmatchedMpesaPayment;
  customer: {
    id: number;
    customerNumber: string;
    customerName: string;
    customerType: string;
    subscriptionStatus: string | null;
  } | null;
  openInvoices: ZohoInvoice[];
  zohoLinked: boolean;
  plannedAction: string;
  canAllocate: boolean;
  alreadyAllocated: boolean;
};

export type AllocateUnmatchedMpesaResult = {
  ok: boolean;
  message: string;
  tispPosted?: boolean;
  tispError?: string | null;
  customerId?: number | null;
  customerNumber?: string;
  zoho?: {
    paid?: boolean;
    strategy?: string;
    invoice_id?: string;
    invoice_number?: string;
  };
};

export type ReconciliationCustomerDetail = ReconciliationCustomerRow & {
  customer: Customer;
  invoices: ZohoInvoice[];
  mpesaPayments: Array<CustomerPayment & { matchedToZoho?: boolean; id?: number | string }>;
  zohoPayments: CustomerPayment[];
  recurringInvoices: Array<{
    id: string;
    status: string;
    nextInvoiceDate: string | null;
    lastSentDate: string | null;
  }>;
  validations: Array<{ code: string; severity: string; message: string }>;
  auditTrail: Array<{
    id: number;
    actionType: string;
    previousValue: string | null;
    newValue: string | null;
    reason: string | null;
    userEmail: string | null;
    createdAt: string;
  }>;
  activityTrail: Array<{
    id: number;
    eventType: string;
    title: string;
    message: string | null;
    source: string;
    status: string;
    amount: number | null;
    referenceId: string | null;
    createdAt: string;
  }>;
  zohoError: string | null;
  tispError: string | null;
  billedViaAgency?: boolean;
  agencyName?: string | null;
  billingNote?: string | null;
};

export type Stats = {
  mpesa: {
    total: number;
    success: number;
    failed: number;
    pending: number;
    revenue: number;
  };
  today: { transactions: number; revenue: number };
  month: { transactions: number; revenue: number };
  period: { days: number; transactions: number; revenue: number };
  customers: {
    unique: number;
    returning: number;
    newInPeriod: number;
    returningRate: number;
  };
  subscribers: {
    total: number;
    active: number;
    cancelled: number;
    c2b: number;
    b2b: number;
    tispFailed: number;
    tispPending: number;
    newInPeriod: number;
    buildings: number;
    agencies: number;
    topBuildings: Array<{ building: string; subscribers: number }>;
    topPackages: Array<{ package: string; mbps: number; subscribers: number }>;
    avgCustomerPayment: number;
    avgPaymentsPerCustomer: number;
    tispActive: number;
    tispSuspended: number;
    tispUnknown: number;
  };
  zoho: { total: number; success: number };
  tisp: { total: number; success: number };
  avgTransaction: number;
  recentActivity: Array<{
    id: number;
    source: string;
    status: string;
    amount: number | null;
    label: string | null;
    created_at: string;
  }>;
  chart: Array<{
    day: string;
    count: number;
    revenue: number;
    success: number;
    failed: number;
  }>;
  statusBreakdown: Array<{ status: string; count: number }>;
  channelBreakdown: Array<{ channel: string; count: number; revenue: number }>;
  integrationBreakdown: Array<{ source: string; total: number; success: number }>;
  topCustomers: Array<{
    customer: string;
    phone: string;
    payments: number;
    totalSpent: number;
    lastPayment: string;
  }>;
  revenueByBuilding: Array<{ building: string; revenue: number; subscribers: number }>;
  activityFeed: ActivityItem[];
};

export type PartnerDashboard = {
  period: { months: number; from: string };
  customers: {
    total: number;
    active: number;
    cancelled: number;
    c2b: number;
    b2b: number;
  };
  periodMetrics: {
    revenue: number;
    added: number;
    lost: number;
    packageChanges: number;
  };
  packageChanges: {
    upgrades: number;
    downgrades: number;
    apartmentSwitches: number;
    typeChanges: number;
    cancellations: number;
  };
  revenueByMonth: Array<{
    year: number;
    month: number;
    label: string;
    revenue: number;
    paymentCount: number;
  }>;
  customerTrend: Array<{
    year: number;
    month: number;
    label: string;
    added: number;
    lost: number;
    net: number;
  }>;
  packageMix: Array<{ packageName: string; mbps: number; subscribers: number }>;
  buildingMix: Array<{ buildingName: string; subscribers: number }>;
  lifecycleBreakdown: Array<{ event: string; count: number }>;
};

export type SupportStats = {
  period: { days: number };
  subscribers: Pick<
    Stats["subscribers"],
    | "total"
    | "active"
    | "cancelled"
    | "c2b"
    | "b2b"
    | "tispFailed"
    | "tispPending"
    | "newInPeriod"
    | "buildings"
    | "agencies"
    | "topBuildings"
    | "topPackages"
  >;
  subscriptionStatus: Array<{ status: string; count: number }>;
  tispSync: { synced: number; failed: number; pending: number };
  activity: ActivityItem[];
};

type Paginated<T> = {
  data: T[];
  pagination: { page: number; limit: number; total: number; pages: number };
  browseMode?: boolean;
  searchMode?: boolean;
  sync?: {
    status: string;
    lastSyncAt?: string | null;
    fullZohoReady?: boolean;
    progress?: ReconciliationSyncProgress;
  };
};

export type ListPagination = Paginated<unknown>["pagination"];

export type MonthlyPaymentChurnSummary = {
  month: string;
  period: { from: string; to: string };
  total: number;
  totalOutstanding: number;
  byReason: Array<{
    reason: string;
    label: string;
    count: number;
    outstanding: number;
  }>;
};

export type ReportDefinition = {
  id: string;
  title: string;
  description: string;
  category: string;
  dateFilter: boolean;
  monthFilter?: boolean;
};

export type BiDashboardFilters = {
  from?: string;
  to?: string;
  buildingId?: string;
  productId?: string;
  agencyId?: string;
  customerStatus?: string;
  subscriptionStatus?: string;
  hasDstv?: string;
  internetOnly?: string;
  internetTv?: string;
};

export type BiFilterOptions = {
  buildings: Array<{ id: number; name: string }>;
  products: Array<{ id: number; name: string; hasDstv: boolean }>;
  agencies: Array<{ id: number; name: string }>;
};

export type BiDashboard = {
  period: { from: string; to: string };
  filterOptions: BiFilterOptions;
  kpis: {
    totalActiveCustomers: number;
    totalSuspendedCustomers: number;
    totalDisconnectedCustomers: number;
    mrr: number;
    revenueCollectedThisMonth: number;
    outstandingInvoiceBalance: number;
    collectionRate: number;
    newCustomersThisMonth: number;
    customerChurnRate: number;
    activeTvSubscribers: number;
    arpu: number;
    avgCustomerLifetimeValue: number;
    avgInstallationTimeDays: number | null;
    activeSupportTickets: number | null;
    networkUptimePct: number | null;
    trends: {
      revenueCollected: number;
      newCustomers: number;
      mrr: number;
      churnRate: number;
    };
  };
  revenue: {
    monthlyTrend: Array<{
      month: string;
      totalRevenue: number;
      recurringRevenue: number;
      installationRevenue: number;
      forecast?: number | null;
    }>;
    byPackage: Array<{
      package: string;
      packageId?: number;
      customers: number;
      monthlyRevenue: number;
      revenue: number;
    }>;
    byArea: Array<{ area: string; buildingId: number; revenue: number; customers: number }>;
    forecast: Array<{
      month: string;
      totalRevenue: number;
      forecast: number | null;
    }>;
  };
  customers: {
    growth: Array<{ day: string; new: number; churned: number }>;
    churn: Array<{
      day: string;
      churnRate: number;
      newCustomers: number;
      lostCustomers: number;
      activeCustomers: number;
    }>;
    packagePopularity: Array<{ package: string; subscribers: number; revenue: number }>;
    tvAdoption: Array<{ segment: string; count: number }>;
    geographic: Array<{ buildingId: number; area: string; customers: number; mrr: number }>;
    clvByPackage: Array<{ package: string; clv: number }>;
  };
  sales: {
    leaderboard: Array<{
      agencyId: number;
      agent: string;
      customersAcquired: number;
      revenue: number;
      conversionRate: number;
    }>;
    funnel: Array<{ stage: string; count: number }>;
  };
  financial: {
    collectionPerformance: Array<{
      month: string;
      invoiced: number;
      paid: number;
      outstanding: number;
    }>;
    debtAging: Array<{ bucket: string; amount: number }>;
    paymentStatus: Array<{ status: string; count: number }>;
  };
  operations: {
    installations: { available: boolean; message: string };
    supportTickets: { available: boolean; message: string };
    avgInstallTime: unknown[];
  };
  network: {
    uptime: { today: number | null; monthly: number | null; annual: number | null; message?: string };
    bandwidth: unknown[];
    speedComplaints: unknown[];
    outagesByArea: Array<{ area: string; outages: number }>;
  };
  insights: {
    upgradeDowngrade: Array<{ month: string; upgrades: number; downgrades: number }>;
    referralSources: Array<{ source: string; count: number }>;
    profitMarginByPackage: Array<{
      package: string;
      revenue: number;
      networkCost: number;
      supportCost: number;
      margin: number;
    }>;
    routerInventory: unknown[];
    dataConsumption: unknown[];
    peakUsageHeatmap: unknown[];
  };
  meta: { generatedAt: string; cached: boolean };
};

export type ReportAnalytics = {
  period: { from: string; to: string };
  summary: {
    totalRevenue: number;
    totalTransactions: number;
    successRate: number;
    activeSubscribers: number;
    newSubscribers: number;
    churned: number;
    avgTransactionValue: number;
  };
  revenueTrend: Array<{
    day: string;
    revenue: number;
    transactions: number;
    success: number;
    failed: number;
  }>;
  paymentStatus: Array<{ status: string; count: number; revenue: number }>;
  revenueByChannel: Array<{ channel: string; count: number; revenue: number }>;
  subscriberTypeMix: Array<{ type: string; active: number; cancelled: number }>;
  revenueByBuilding: Array<{ building: string; revenue: number; subscribers: number }>;
  packageMix: Array<{ package: string; subscribers: number; revenue: number }>;
  subscriberGrowth: Array<{ day: string; new: number; churned: number }>;
  agencyPerformance: Array<{ agency: string; customers: number; revenue: number }>;
  lifecycleEvents: Array<{ event: string; count: number }>;
  paymentFrequencyMix: Array<{ frequency: string; count: number }>;
  tispSyncStatus: Array<{ status: string; count: number }>;
  failureReasons: Array<{ reason: string; count: number }>;
  integrationHealth: Array<{ source: string; total: number; success: number; failed: number }>;
  arpuByBuilding: Array<{ building: string; arpu: number; payers: number; revenue: number }>;
};

function buildQueryString(params: Record<string, string | undefined> = {}) {
  const entries = Object.entries(params).filter(
    ([, value]) => value != null && String(value).trim() !== ""
  );
  if (!entries.length) return "";
  return `?${new URLSearchParams(entries as [string, string][]).toString()}`;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    rejectApiResponse(res, body, path);
  }

  return res.json();
}

async function downloadExport(path: string, filename: string) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    rejectApiResponse(res, body, path);
  }
  const blob = await res.blob();
  downloadBlobFile(filename, blob);
}

function downloadBlobFile(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportFilename(base: string, scope: string, format: "csv" | "xls" | "pdf") {
  const suffix = scope === "all" ? "all-records" : "current-view";
  const ext = format === "xls" ? "xlsx" : format === "pdf" ? "pdf" : "csv";
  return `${base}-${suffix}.${ext}`;
}

async function downloadReportFile(
  reportId: string,
  params: Record<string, string>
) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/admin/reports/${reportId}/download?${qs}`, {
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    rejectApiResponse(res, body, `/admin/reports/${reportId}/download`);
  }
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] || `report.${params.format === "pdf" ? "pdf" : "xlsx"}`;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const api = {
  login: (email: string, password: string) =>
    request<{ user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  me: () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    return request<{ user: User }>("/auth/me", { signal: controller.signal }).finally(() =>
      window.clearTimeout(timer)
    );
  },

  getLoginStats: () =>
    request<{
      totalRevenue: number;
      totalTransactions: number;
      successRate: number;
      failedCount: number;
      todayTransactions: number;
      todayRevenue: number;
      monthRevenue: number;
      monthTransactions: number;
      returningCustomers: number;
      activeCustomers: number;
      integrationsActive: number;
    }>("/public/login-stats"),

  getStats: (period = "30d") =>
    request<Stats>(`/admin/stats?period=${period}`),

  getSupportStats: (period = "30d") =>
    request<SupportStats>(`/admin/support-stats?period=${period}`),

  getPartnerDashboard: (months = 12) =>
    request<PartnerDashboard>(`/admin/partner/dashboard?months=${months}`),

  getRevenueChart: (month: string, year = new Date().getFullYear()) =>
    request<{ month: string; year: number; chart: Stats["chart"] }>(
      `/admin/revenue-chart?month=${encodeURIComponent(month)}&year=${year}`
    ),

  getActivity: (limit = 40) =>
    request<{ data: ActivityItem[] }>(`/admin/activity?limit=${limit}`),

  getTransactions: (params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request<Paginated<UnifiedTransaction>>(
      `/admin/transactions${qs ? `?${qs}` : ""}`
    );
  },

  getMpesaTransaction: (id: number) =>
    request<MpesaTransactionDetail>(`/admin/transactions/mpesa/${id}`),

  getIntegrationEvent: (id: number) =>
    request<{ event: IntegrationEventDetail }>(`/admin/transactions/integration/${id}`),

  getMpesaTransactions: (params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request<Paginated<MpesaTransaction>>(
      `/admin/transactions/mpesa${qs ? `?${qs}` : ""}`
    );
  },

  getZohoEvents: (params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request<Paginated<IntegrationEvent>>(
      `/admin/transactions/zoho${qs ? `?${qs}` : ""}`
    );
  },

  getTispEvents: (params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request<Paginated<IntegrationEvent>>(
      `/admin/transactions/tisp${qs ? `?${qs}` : ""}`
    );
  },

  exportMpesa: (params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return downloadExport(
      `/admin/transactions/mpesa/export${qs ? `?${qs}` : ""}`,
      "mpesa-transactions.csv"
    );
  },

  exportZoho: (params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return downloadExport(
      `/admin/transactions/zoho/export${qs ? `?${qs}` : ""}`,
      "zoho-events.csv"
    );
  },

  exportTisp: (params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return downloadExport(
      `/admin/transactions/tisp/export${qs ? `?${qs}` : ""}`,
      "tisp-events.csv"
    );
  },

  listUsers: () => request<{ users: AdminUser[] }>("/admin/users"),

  getSettings: () => request<AppSettings>("/admin/settings"),

  createUser: (data: {
    name: string;
    email: string;
    password: string;
    role: string;
  }) =>
    request<{ ok: boolean }>("/admin/users", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateUser: (id: number, data: { role?: string; is_active?: boolean }) =>
    request<{ ok: boolean }>(`/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  resetUserPassword: (id: number, password: string) =>
    request<{ ok: boolean }>(`/admin/users/${id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  listBuildings: (params: Record<string, string | undefined> = {}) =>
    request<{ buildings: Building[]; data: Building[]; pagination: ListPagination }>(
      `/admin/buildings${buildQueryString(params)}`
    ),

  createBuilding: (data: {
    name: string;
    c2bCode: string;
    b2bCode: string;
    ipSetup: "STATIC" | "PPOE";
    dstvSetup: "headend_coax" | "decoder";
    ipPrefixes?: string[];
  }) =>
    request<{ ok: boolean; id: number; building: Building }>("/admin/buildings", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateBuilding: (
    id: number,
    data: Partial<{
      name: string;
      c2bCode: string;
      b2bCode: string;
      ipSetup: "STATIC" | "PPOE";
      dstvSetup: "headend_coax" | "decoder";
      ipPrefixes: string[];
    }>
  ) =>
    request<{ ok: boolean; building: Building }>(`/admin/buildings/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  listProducts: (params: Record<string, string | undefined> = {}) => {
    return request<{
      products: Product[];
      data: Product[];
      pagination: ListPagination;
    }>(`/admin/products${buildQueryString(params)}`);
  },

  getPackageCatalog: () =>
    request<{ categories: PackageCategory[] }>("/admin/package-catalog"),

  createProduct: (data: {
    planVariantId: number;
    buildingId: number;
    mbps?: number;
    price: number;
    monthlyPrice?: number;
    extraBandwidth?: number;
  }) =>
    request<{ ok: boolean; id: number }>("/admin/products", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateProduct: (
    id: number,
    data: Partial<{
      planVariantId: number;
      name: string;
      mbps: number;
      price: number;
      monthlyPrice: number;
      extraBandwidth: number;
      isActive: boolean;
      hasDstv: boolean;
      paymentFrequency: string;
    }>
  ) =>
    request<{ ok: boolean; product: Product }>(`/admin/products/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  listAgencies: (params: Record<string, string | undefined> = {}) =>
    request<{
      agencies: Agency[];
      data: Agency[];
      pagination: ListPagination;
    }>(`/admin/agencies${buildQueryString(params)}`),

  downloadCustomerImportTemplate: () =>
    downloadExport(
      "/admin/customers/import/template",
      "customer-import-template.csv"
    ),

  importCustomers: async (file: File) => {
    const text = await file.text();
    const res = await fetch(`${API_BASE}/admin/customers/import`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "text/csv" },
      body: text,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      rejectApiResponse(res, body, "/admin/customers/import");
    }
    return res.json() as Promise<{
      ok: boolean;
      total: number;
      succeeded: number;
      failed: number;
      results: Array<{
        line: number;
        ok: boolean;
        customerNumber?: string;
        error?: string;
        tispOk?: boolean;
        tispError?: string | null;
        zohoOk?: boolean;
        zohoError?: string | null;
        zohoLinked?: boolean;
        zohoInvoiceCount?: number;
        zohoUnpaidCount?: number;
      }>;
    }>;
  },

  importCustomersStream: async (
    file: File,
    onEvent: (event: CustomerImportEvent) => void
  ) => {
    const text = await file.text();
    const res = await fetch(`${API_BASE}/admin/customers/import?stream=1`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "text/csv" },
      body: text,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      rejectApiResponse(res, body, "/admin/customers/import?stream=1");
    }
    if (!res.body) {
      throw new Error("Import stream unavailable");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        onEvent(JSON.parse(trimmed));
      }
    }

    const trailing = buffer.trim();
    if (trailing) {
      onEvent(JSON.parse(trailing));
    }
  },

  createAgency: (data: {
    name: string;
    email: string;
    phone: string;
    contactPerson?: string;
  }) =>
    request<{ ok: boolean; id: number }>("/admin/agencies", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateAgency: (
    id: number,
    data: Partial<{
      name: string;
      email: string;
      phone: string;
      contactPerson: string;
    }>
  ) =>
    request<{ ok: boolean; agency: Agency }>(`/admin/agencies/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  getAgency: (id: number) =>
    request<{
      agency: Agency;
      customers: Customer[];
      billing: AgencyBilling;
      zoho: AgencyZohoStatus;
    }>(`/admin/agencies/${id}`),

  getAgencyInvoices: (id: number) =>
    request<AgencyZohoStatus & { invoices: ZohoInvoice[] }>(
      `/admin/agencies/${id}/invoices`
    ),

  createAgencyInvoice: (id: number, data: AgencyInvoicePayload) =>
    request<{
      ok: boolean;
      invoice: {
        id: string;
        invoiceNumber: string | null;
        subtotal: number;
        discountAmount: number;
        total: number;
        status: string;
        zohoContactId: string;
      };
      billedCustomers: Array<{
        id: number;
        customerNumber: string;
        fullName: string;
        packagePrice: number;
      }>;
    }>(`/admin/agencies/${id}/invoices`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  listCustomers: (params: Record<string, string | undefined> = {}) =>
    request<Paginated<Customer>>(`/admin/customers${buildQueryString(params)}`),
  exportCustomers: (
    params: Record<string, string | undefined> = {},
    format: "csv" | "xls" | "pdf" = "csv"
  ) => {
    const scope = params.scope || "view";
    return downloadExport(
      `/admin/customers/export${buildQueryString({ ...params, format, scope })}`,
      exportFilename("customers", scope, format)
    );
  },

  exportTableReport: async (
    report: {
      title: string;
      headers: Array<{ key: string; label: string }>;
      rows: Array<Record<string, string | number | null | undefined>>;
    },
    format: "csv" | "xls" | "pdf",
    filename: string
  ) => {
    const filenameBase = filename.replace(/\.(csv|xlsx|pdf)$/i, "");
    const res = await fetch(`${API_BASE}/admin/export/table`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...report, format, filenameBase }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      rejectApiResponse(res, body, "/admin/export/table");
    }
    const blob = await res.blob();
    downloadBlobFile(filename, blob);
  },

  exportTransactions: (
    params: Record<string, string | undefined> = {},
    format: "csv" | "xls" | "pdf" = "csv"
  ) => {
    const scope = params.scope || "all";
    return downloadExport(
      `/admin/transactions/export${buildQueryString({ ...params, format })}`,
      exportFilename("transactions", scope, format)
    );
  },

  getCustomer: (id: number, refresh = false) =>
    request<{ customer: Customer; events: CustomerEvent[]; pendingUpgrade?: PendingUpgrade | null }>(
      `/admin/customers/${id}${refresh ? "?refresh=true" : ""}`
    ),

  refreshCustomer: (id: number) =>
    request<{
      customer: Customer;
      events: CustomerEvent[];
      pendingUpgrade?: PendingUpgrade | null;
      zoho: CustomerZohoStatus;
      tisp: { refreshed: boolean };
    }>(`/admin/customers/${id}/refresh`, { method: "POST" }),

  retryBillingOnboarding: (id: number) =>
    request<{
      ok: boolean;
      billing: {
        ok: boolean;
        linked: boolean;
        zohoContactId: string | null;
        invoice: {
          created?: boolean;
          reused?: boolean;
          invoiceId?: string | null;
          invoiceNumber?: string | null;
          emailed?: boolean;
          total?: number;
        } | null;
        recurring?: {
          created?: boolean;
          updated?: boolean;
          recurringInvoiceId?: string;
        } | null;
        error?: string;
      };
      customer: Customer;
      zoho: CustomerZohoStatus;
    }>(`/admin/customers/${id}/retry-billing-onboarding`, { method: "POST" }),

  getCustomerInvoices: (id: number) =>
    request<{
      invoices: ZohoInvoice[];
      zohoLinked: boolean;
      zohoContactId: string | null;
      billedViaAgency?: boolean;
      agencyName?: string | null;
      billingNote?: string | null;
      lastSyncedAt?: string | null;
      fromSnapshot?: boolean;
      cacheFresh?: boolean;
      creditBalance?: number;
    }>(`/admin/customers/${id}/invoices`),

  getCustomerPayments: (id: number, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request<{ payments: CustomerPayment[] }>(
      `/admin/customers/${id}/payments${qs ? `?${qs}` : ""}`
    );
  },

  getCustomerTransactions: (id: number, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request<Paginated<UnifiedTransaction>>(
      `/admin/customers/${id}/transactions${qs ? `?${qs}` : ""}`
    );
  },

  createCustomer: (data: Record<string, unknown>) =>
    request<{ ok: boolean; customer: Customer; tisp: { ok: boolean; error?: string } }>(
      "/admin/customers",
      { method: "POST", body: JSON.stringify(data) }
    ),

  updateCustomer: (
    id: number,
    data: {
      firstName: string;
      lastName: string;
      middleName?: string;
      phone: string;
      email: string;
      isVatExempt?: boolean;
      customerType?: "C2B" | "B2B";
      agencyId?: number;
      apartmentNumber?: string;
      paymentFrequency?: Customer["paymentFrequency"];
      customPeriodDays?: number;
      productId?: number;
      ipAddress?: string;
      dstvDecoderSerial?: string;
      /** Create Zoho signup invoice when provisioning a missing Zoho contact (default false). */
      createInitialInvoice?: boolean;
      /** Create Zoho recurring when provisioning missing Zoho contact (default false). */
      createRecurringInvoice?: boolean;
      /** Update/create Zoho recurring when already linked (default false). */
      updateZohoRecurring?: boolean;
      /** Required when creating on TISP; optional update when already on TISP (YYYY-MM-DD). */
      tispDueDate?: string;
    }
  ) =>
    request<{
      ok: boolean;
      customer: Customer;
      tisp: { ok: boolean; error?: string; created?: boolean; updated?: boolean };
      zoho?: {
        ok: boolean;
        error?: string;
        created?: boolean;
        updated?: boolean;
        skipped?: boolean;
      };
    }>(`/admin/customers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  getCustomerIntegrations: (id: number) =>
    request<{
      customerId: number;
      customerNumber: string;
      customerType: string;
      onTisp: boolean;
      onZoho: boolean;
      zohoContactId: string | null;
      tispDueDate: string | null;
      isB2B: boolean;
    }>(`/admin/customers/${id}/integrations`),

  convertCustomerType: (
    id: number,
    data: {
      customerType: "C2B" | "B2B";
      agencyId?: number;
      newAgency?: {
        name: string;
        email: string;
        phone: string;
        contactPerson?: string;
      };
    }
  ) =>
    request<{
      ok: boolean;
      customer: Customer;
      previousType: string;
      newType: string;
      previousCustomerNumber: string;
      newCustomerNumber: string;
      agencyId: number | null;
      agencyName: string | null;
      tisp: { ok: boolean; error?: string };
    }>(`/admin/customers/${id}/convert-type`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getUpgradeQuote: (
    id: number,
    productId: number,
    billing?: {
      paymentFrequency?: Customer["paymentFrequency"];
      customPeriodDays?: number | null;
    }
  ) =>
    request<{ quote: UpgradeQuote }>(
      `/admin/customers/${id}/upgrade-quote${buildQueryString({
        productId: String(productId),
        paymentFrequency: billing?.paymentFrequency,
        customPeriodDays:
          billing?.customPeriodDays != null
            ? String(billing.customPeriodDays)
            : undefined,
      })}`
    ),

  getDowngradeQuote: (
    id: number,
    productId: number,
    billing?: {
      paymentFrequency?: Customer["paymentFrequency"];
      customPeriodDays?: number | null;
    }
  ) =>
    request<{ quote: UpgradeQuote }>(
      `/admin/customers/${id}/downgrade-quote${buildQueryString({
        productId: String(productId),
        paymentFrequency: billing?.paymentFrequency,
        customPeriodDays:
          billing?.customPeriodDays != null
            ? String(billing.customPeriodDays)
            : undefined,
      })}`
    ),

  upgradeCustomer: (
    id: number,
    productId: number,
    options?: {
      paymentMethod?: UpgradePaymentMethod;
      paymentFrequency?: Customer["paymentFrequency"];
      customPeriodDays?: number | null;
    }
  ) =>
    request<{
      ok: boolean;
      pending?: boolean;
      customer: Customer;
      quote?: UpgradeQuote;
      pendingUpgrade?: PendingUpgrade;
      payment?: {
        method: UpgradePaymentMethod;
        invoiceId?: string | null;
        invoiceNumber?: string | null;
        checkoutRequestId?: string | null;
        amount?: number;
        phone?: string;
      };
      tisp?: { ok: boolean; error?: string };
    }>(`/admin/customers/${id}/upgrade`, {
      method: "POST",
      body: JSON.stringify({
        productId,
        paymentMethod: options?.paymentMethod,
        paymentFrequency: options?.paymentFrequency,
        customPeriodDays: options?.customPeriodDays,
      }),
    }),

  cancelPendingUpgrade: (id: number) =>
    request<{
      ok: boolean;
      customer: Customer;
      pendingUpgrade: PendingUpgrade | null;
    }>(`/admin/customers/${id}/upgrade/cancel`, { method: "POST" }),

  downgradeCustomer: (
    id: number,
    productId: number,
    billing?: {
      paymentFrequency?: Customer["paymentFrequency"];
      customPeriodDays?: number | null;
    }
  ) =>
    request<{
      ok: boolean;
      customer: Customer;
      quote?: UpgradeQuote;
      creditNote?: {
        creditNoteId: string | null;
        creditNoteNumber: string | null;
        total: number;
      } | null;
      creditNoteError?: string;
      tisp?: { ok: boolean; error?: string };
    }>(`/admin/customers/${id}/downgrade`, {
      method: "POST",
      body: JSON.stringify({
        productId,
        paymentFrequency: billing?.paymentFrequency,
        customPeriodDays: billing?.customPeriodDays,
      }),
    }),

  changeCustomerPaymentFrequency: (
    id: number,
    data: {
      paymentFrequency: Customer["paymentFrequency"];
      customPeriodDays?: number | null;
    }
  ) =>
    request<{
      ok: boolean;
      customer: Customer;
      packagePrice: number;
      tisp?: { ok: boolean; error?: string };
    }>(`/admin/customers/${id}/change-payment-frequency`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  switchCustomerApartment: (id: number, apartmentNumber: string) =>
    request<{ ok: boolean; customer: Customer; tisp?: { ok: boolean; error?: string } }>(
      `/admin/customers/${id}/switch-apartment`,
      { method: "POST", body: JSON.stringify({ apartmentNumber }) }
    ),

  cancelCustomer: (id: number, notes?: string) =>
    request<{
      ok: boolean;
      customer: Customer;
      tisp?: { ok: boolean; skipped?: boolean; dueDate?: string; error?: string; reason?: string };
      zoho?: {
        ok: boolean;
        skipped?: boolean;
        contactInactivated?: boolean;
        recurringStopped?: number;
        error?: string;
        reason?: string;
      };
    }>(`/admin/customers/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ notes }),
    }),

  disconnectCustomer: (id: number, notes?: string) =>
    request<{
      ok: boolean;
      customer: Customer;
      tisp?: { ok: boolean; skipped?: boolean; dueDate?: string; error?: string; reason?: string };
    }>(`/admin/customers/${id}/disconnect`, {
      method: "POST",
      body: JSON.stringify({ notes }),
    }),

  deleteCustomerPermanently: (id: number) =>
    request<{ ok: boolean; customerNumber: string }>(`/admin/customers/${id}`, {
      method: "DELETE",
    }),

  bulkCancelCustomers: (ids: number[], notes?: string) =>
    request<{
      ok: boolean;
      total: number;
      succeeded: number;
      failed: number;
      results: Array<{
        id: number;
        ok: boolean;
        customerNumber?: string | null;
        error?: string;
        tisp?: { ok: boolean; error?: string };
        zoho?: { ok: boolean; error?: string };
      }>;
    }>("/admin/customers/bulk-cancel", {
      method: "POST",
      body: JSON.stringify({ ids, notes }),
    }),

  getApartmentHistory: (buildingId: number, apartmentNumber: string) =>
    request<{ history: ApartmentHistoryEntry[] }>(
      `/admin/buildings/${buildingId}/apartments/${encodeURIComponent(apartmentNumber)}/history`
    ),

  listApartmentHistory: (params: Record<string, string | undefined> = {}) =>
    request<Paginated<ApartmentHistoryEntry>>(
      `/admin/apartments/history${buildQueryString(params)}`
    ),

  checkApartmentOccupancy: (
    buildingId: number,
    apartmentNumber: string,
    excludeCustomerId?: number
  ) =>
    request<ApartmentOccupancy>(
      `/admin/apartments/check${buildQueryString({
        buildingId: String(buildingId),
        apartmentNumber,
        excludeCustomerId:
          excludeCustomerId != null ? String(excludeCustomerId) : undefined,
      })}`
    ),

  listLogs: (params: Record<string, string | undefined> = {}) =>
    request<Paginated<ApiCallLog>>(`/admin/logs${buildQueryString(params)}`),

  getLog: (id: number) => request<{ log: ApiCallLog }>(`/admin/logs/${id}`),

  retryLog: (id: number) =>
    request<{ ok: boolean; message?: string; error?: string }>(`/admin/logs/${id}/retry`, {
      method: "POST",
    }),

  listReports: () =>
    request<{ reports: ReportDefinition[] }>("/admin/reports"),

  getMonthlyPaymentChurnSummary: (month: string) =>
    request<MonthlyPaymentChurnSummary>(
      `/admin/reports/monthly-payment-churn/summary?month=${encodeURIComponent(month)}`
    ),

  getReportAnalytics: (params: { from?: string; to?: string } = {}) => {
    const qs = buildQueryString({
      from: params.from,
      to: params.to,
    });
    return request<ReportAnalytics>(`/admin/reports/analytics${qs}`);
  },

  getBiDashboard: (params: BiDashboardFilters = {}) =>
    request<BiDashboard>(
      `/admin/bi/dashboard${buildQueryString({
        from: params.from,
        to: params.to,
        buildingId: params.buildingId,
        productId: params.productId,
        agencyId: params.agencyId,
        customerStatus: params.customerStatus,
        subscriptionStatus: params.subscriptionStatus,
        hasDstv: params.hasDstv,
        internetOnly: params.internetOnly,
        internetTv: params.internetTv,
      })}`
    ),

  exportBiSection: (section: string, params: BiDashboardFilters = {}) => {
    const qs = buildQueryString({
      section,
      from: params.from,
      to: params.to,
      buildingId: params.buildingId,
      productId: params.productId,
      agencyId: params.agencyId,
      customerStatus: params.customerStatus,
      subscriptionStatus: params.subscriptionStatus,
    });
    return downloadExport(`/admin/bi/export${qs}`, `bi-${section}.csv`);
  },

  downloadReport: (reportId: string, params: Record<string, string>) =>
    downloadReportFile(reportId, params),

  getReconciliationSummary: (opts?: { cached?: boolean }) =>
    request<ReconciliationSummary>(
      `/admin/reconciliation/summary${opts?.cached ? "?cached=1" : ""}`
    ),

  getReconciliationSyncStatus: () =>
    request<ReconciliationSyncStatus>("/admin/reconciliation/sync-status"),

  runReconciliationSync: (fullZoho = true) =>
    request<{
      ok: boolean;
      queued?: boolean;
      jobId?: string;
      syncJobDbId?: number;
      message?: string;
      customersScanned?: number;
      issuesFound?: number;
      unmatchedMpesa?: number;
      syncedAt?: string;
      error?: string;
    }>("/admin/reconciliation/sync", {
      method: "POST",
      body: JSON.stringify({ fullZoho }),
    }),

  listReconciliationCustomers: (params: Record<string, string | undefined> = {}) =>
    request<Paginated<ReconciliationCustomerRow>>(
      `/admin/reconciliation/customers${buildQueryString(params)}`
    ),

  getReconciliationCustomer: (id: number, refresh = false) =>
    request<ReconciliationCustomerDetail>(
      `/admin/reconciliation/customers/${id}${refresh ? "?refresh=true" : ""}`
    ),

  listReconciliationUnmatchedMpesa: () =>
    request<{ data: UnmatchedMpesaPayment[] }>("/admin/reconciliation/unmatched-mpesa"),

  getUnmatchedMpesaDetail: (id: number) =>
    request<UnmatchedMpesaDetail>(`/admin/reconciliation/unmatched-mpesa/${id}`),

  allocateUnmatchedMpesa: (id: number) =>
    request<AllocateUnmatchedMpesaResult>(
      `/admin/reconciliation/unmatched-mpesa/${id}/allocate`,
      { method: "POST" }
    ),

  executeReconciliationAction: (
    customerId: number,
    action: string,
    payload: Record<string, unknown> = {}
  ) =>
    request<{ ok: boolean; message?: string; customer?: ReconciliationCustomerRow }>(
      `/admin/reconciliation/customers/${customerId}/actions`,
      { method: "POST", body: JSON.stringify({ action, ...payload }) }
    ),

  exportReconciliation: (
    params: Record<string, string> = {},
    format: "csv" | "xls" | "pdf" = "csv"
  ) => {
    const scope = params.scope || "all";
    return downloadExport(
      `/admin/reconciliation/export${buildQueryString({ ...params, format })}`,
      exportFilename("billing-reconciliation", scope, format)
    );
  },

  listReconciliationStatuses: () =>
    request<{ statuses: string[] }>("/admin/reconciliation/statuses"),

  listBillingCommunications: (params: Record<string, string | undefined> = {}) =>
    request<{
      data: BillingCommunicationCandidate[];
      pagination: ListPagination;
      mailConfig: ReconciliationSummary["mailConfig"];
    }>(`/admin/reconciliation/communications${buildQueryString(params)}`),

  previewBillingCommunication: (customerId: number, template?: string) =>
    request<BillingCommunicationPreview>(
      `/admin/reconciliation/communications/${customerId}/preview${template ? `?template=${encodeURIComponent(template)}` : ""}`
    ),

  sendBillingCommunication: (customerId: number, templateKey?: string) =>
    request<{ ok: boolean; message: string }>(
      `/admin/reconciliation/communications/${customerId}/send`,
      {
        method: "POST",
        body: JSON.stringify(templateKey ? { templateKey } : {}),
      }
    ),

  sendBulkBillingCommunications: (customerIds: number[]) =>
    request<{ ok: boolean; sent: number; failed: number; results: Array<{ customerId: number; ok: boolean; message?: string; error?: string }> }>(
      "/admin/reconciliation/communications/bulk-send",
      { method: "POST", body: JSON.stringify({ customerIds }) }
    ),

  getSyncOverview: () => request<SyncOverview>("/admin/sync/overview"),

  listSyncJobs: (params: Record<string, string> = {}) =>
    request<{ data: SyncJobRow[] }>(`/admin/sync/jobs${buildQueryString(params)}`),

  getSyncJob: (id: number) => request<SyncJobRow>(`/admin/sync/jobs/${id}`),

  getRunningSyncJobs: () =>
    request<{ data: SyncJobRow[] }>("/admin/sync/running"),

  triggerSync: (integration: string, body: { fullZoho?: boolean; incremental?: boolean } = {}) =>
    request<{ ok: boolean; jobId?: string; error?: string; status?: string }>(
      `/admin/sync/${integration}/trigger`,
      { method: "POST", body: JSON.stringify(body) }
    ),

  retrySyncJob: (integration: string, jobId: string) =>
    request<{ ok: boolean; error?: string }>(`/admin/sync/${integration}/retry`, {
      method: "POST",
      body: JSON.stringify({ jobId }),
    }),
};

export function formatCurrency(amount: number | null | undefined) {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
  }).format(amount);
}

/** Compact currency for dashboard metric tiles (e.g. 50.7M above 1M). */
export function formatMetricCurrency(amount: number | null | undefined) {
  if (amount == null) return "—";
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";

  if (abs >= 1_000_000_000) {
    const compact = (abs / 1_000_000_000).toFixed(1).replace(/\.0$/, "");
    return `${sign}${compact}B`;
  }
  if (abs >= 1_000_000) {
    const compact = (abs / 1_000_000).toFixed(1).replace(/\.0$/, "");
    return `${sign}${compact}M`;
  }
  return formatCurrency(amount);
}

/** Package prices are VAT-inclusive (16%). */
export function splitVatInclusive(amount: number) {
  const vat = Math.round((amount * 16) / 116);
  return { exclVat: amount - vat, vat };
}

export function formatDate(value: string) {
  return new Date(value).toLocaleString("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDateOnly(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-KE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function timeAgo(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString("en-KE", { month: "short", day: "numeric" });
}
