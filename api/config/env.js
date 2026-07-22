const loadEnv = () => {
  const {
    PORT = 4000,
    NODE_ENV = "development",
    MYSQL_HOST = "localhost",
    MYSQL_PORT = 3306,
    MYSQL_USER = "root",
    MYSQL_PASSWORD = "",
    MYSQL_DATABASE = "",
    MYSQL_CONNECTION_LIMIT = 10,
    JWT_SECRET = "",
    JWT_EXPIRES_IN = "8h",
    ADMIN_ORIGIN = "http://localhost:5173",
    REDIS_HOST = "localhost",
    REDIS_PORT = 6379,
    REDIS_PASSWORD = "",
    REDIS_DB = 0,
    SYNC_ENABLED = "true",
    SYNC_SCHEDULER_ENABLED = "true",
    WORKER_INLINE = "false",
    CUSTOMER_SYNC_INTERVAL_MS = String(15 * 60 * 1000),
    // Zoho Books allows 10k API calls/day — keep invoice sync conservative
    INVOICE_SYNC_INTERVAL_MS = String(30 * 60 * 1000),
    PAYMENT_SYNC_INTERVAL_MS = String(2 * 60 * 1000),
    // Quick reconciliation (local + TISP) every 15 min; full Zoho scan less often
    RECONCILIATION_SYNC_INTERVAL_MS = String(15 * 60 * 1000),
    RECONCILIATION_FULL_ZOHO_INTERVAL_MS = String(6 * 60 * 60 * 1000),
    PRODUCTS_SYNC_INTERVAL_MS = String(60 * 60 * 1000),
    API_TIMEOUT_MS = "30000",
    API_CONCURRENCY = "5",
    ZOHO_SYNC_CONCURRENCY = "2",
    MAX_RETRIES = "3",
    RETRY_BASE_DELAY_MS = "2000",
    CACHE_TTL_SECONDS = "300",
    WORKER_CONCURRENCY = "2",
    SYNC_PAGE_SIZE = "100",
    ZOHO_DAILY_API_LIMIT = "10000",
    ZOHO_DAILY_API_RESERVE = "1500",
    ZOHO_API_BUDGET_ENABLED = "true",
    ZOHO_CALLS_PER_CUSTOMER_ESTIMATE = "4",
    SYNC_INTERVAL_MS = String(60 * 60 * 1000),
    ZOHO_SYNC_INTERVAL_MS = "",
    ZOHO_SYNC_MODE = "minimal",
    ZOHO_SCHEDULED_MODULES = "zoho-contacts,invoices",
    ZOHO_BACKGROUND_SYNC_ENABLED = "true",
    ZOHO_INCREMENTAL_LOOKBACK_DAYS = "7",
    ZOHO_SYNC_MAX_PAGES = "",
    RECONCILIATION_FULL_ZOHO_SCHEDULED = "false",
    CUSTOMER_CACHE_DURATION_SECONDS = "",
    API_WARNING_THRESHOLD = "7000",
    API_CRITICAL_THRESHOLD = "8500",
    API_EMERGENCY_THRESHOLD = "9500",
  } = process.env;

  return {
    PORT: Number(PORT),
    NODE_ENV,
    MYSQL_HOST,
    MYSQL_PORT: Number(MYSQL_PORT),
    MYSQL_USER,
    MYSQL_PASSWORD,
    MYSQL_DATABASE,
    MYSQL_CONNECTION_LIMIT: Number(MYSQL_CONNECTION_LIMIT),
    JWT_SECRET,
    JWT_EXPIRES_IN,
    ADMIN_ORIGIN,
    REDIS_HOST,
    REDIS_PORT: Number(REDIS_PORT),
    REDIS_PASSWORD,
    REDIS_DB: Number(REDIS_DB),
    SYNC_ENABLED: SYNC_ENABLED === "true" || SYNC_ENABLED === "1",
    SYNC_SCHEDULER_ENABLED: SYNC_SCHEDULER_ENABLED === "true" || SYNC_SCHEDULER_ENABLED === "1",
    WORKER_INLINE: WORKER_INLINE === "true" || WORKER_INLINE === "1",
    CUSTOMER_SYNC_INTERVAL_MS: Number(CUSTOMER_SYNC_INTERVAL_MS),
    INVOICE_SYNC_INTERVAL_MS: Number(INVOICE_SYNC_INTERVAL_MS),
    PAYMENT_SYNC_INTERVAL_MS: Number(PAYMENT_SYNC_INTERVAL_MS),
    RECONCILIATION_SYNC_INTERVAL_MS: Number(RECONCILIATION_SYNC_INTERVAL_MS),
    RECONCILIATION_FULL_ZOHO_INTERVAL_MS: Number(RECONCILIATION_FULL_ZOHO_INTERVAL_MS),
    PRODUCTS_SYNC_INTERVAL_MS: Number(PRODUCTS_SYNC_INTERVAL_MS),
    API_TIMEOUT_MS: Number(API_TIMEOUT_MS),
    API_CONCURRENCY: Number(API_CONCURRENCY),
    ZOHO_SYNC_CONCURRENCY: Number(ZOHO_SYNC_CONCURRENCY),
    MAX_RETRIES: Number(MAX_RETRIES),
    RETRY_BASE_DELAY_MS: Number(RETRY_BASE_DELAY_MS),
    CACHE_TTL_SECONDS: Number(CACHE_TTL_SECONDS),
    WORKER_CONCURRENCY: Number(WORKER_CONCURRENCY),
    SYNC_PAGE_SIZE: Number(SYNC_PAGE_SIZE),
    ZOHO_DAILY_API_LIMIT: Number(ZOHO_DAILY_API_LIMIT),
    ZOHO_DAILY_API_RESERVE: Number(ZOHO_DAILY_API_RESERVE),
    ZOHO_API_BUDGET_ENABLED: ZOHO_API_BUDGET_ENABLED === "true" || ZOHO_API_BUDGET_ENABLED === "1",
    ZOHO_CALLS_PER_CUSTOMER_ESTIMATE: Number(ZOHO_CALLS_PER_CUSTOMER_ESTIMATE),
    SYNC_INTERVAL_MS: Number(SYNC_INTERVAL_MS),
    ZOHO_SYNC_INTERVAL_MS: ZOHO_SYNC_INTERVAL_MS
      ? Number(ZOHO_SYNC_INTERVAL_MS)
      : Number(SYNC_INTERVAL_MS),
    ZOHO_SYNC_MODE,
    ZOHO_SCHEDULED_MODULES,
    ZOHO_BACKGROUND_SYNC_ENABLED:
      ZOHO_BACKGROUND_SYNC_ENABLED === "true" || ZOHO_BACKGROUND_SYNC_ENABLED === "1",
    ZOHO_INCREMENTAL_LOOKBACK_DAYS: Number(ZOHO_INCREMENTAL_LOOKBACK_DAYS),
    ZOHO_SYNC_MAX_PAGES: ZOHO_SYNC_MAX_PAGES
      ? Number(ZOHO_SYNC_MAX_PAGES)
      : ZOHO_SYNC_MODE === "minimal"
        ? 3
        : 25,
    RECONCILIATION_FULL_ZOHO_SCHEDULED:
      RECONCILIATION_FULL_ZOHO_SCHEDULED === "true" ||
      RECONCILIATION_FULL_ZOHO_SCHEDULED === "1",
    CUSTOMER_CACHE_DURATION_SECONDS: CUSTOMER_CACHE_DURATION_SECONDS
      ? Number(CUSTOMER_CACHE_DURATION_SECONDS)
      : Number(CACHE_TTL_SECONDS),
    API_WARNING_THRESHOLD: Number(API_WARNING_THRESHOLD),
    API_CRITICAL_THRESHOLD: Number(API_CRITICAL_THRESHOLD),
    API_EMERGENCY_THRESHOLD: Number(API_EMERGENCY_THRESHOLD),
  };
};

const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Validates required secrets at boot. Exits the process in production when
 * critical auth configuration is missing or weak.
 */
function validateProductionSecrets(env) {
  if (env.NODE_ENV !== "production") return;

  const errors = [];

  if (!env.JWT_SECRET || env.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
    errors.push(
      `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters in production`
    );
  }

  if (!process.env.ZOHO_WEBHOOK_SECRET) {
    errors.push("ZOHO_WEBHOOK_SECRET is required in production");
  }

  if (!process.env.USSD_API_SECRET) {
    errors.push("USSD_API_SECRET is required in production");
  }

  const whatsappConfigured = Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
  );
  if (whatsappConfigured && !process.env.WHATSAPP_APP_SECRET) {
    errors.push(
      "WHATSAPP_APP_SECRET is required in production when WhatsApp is configured"
    );
  }

  const mpesaConfigured = Boolean(
    process.env.MPESA_CONSUMER_KEY || process.env.CONSUMER_KEY
  );
  if (mpesaConfigured && !process.env.MPESA_CALLBACK_SECRET) {
    console.warn(
      "[security] MPESA_CALLBACK_SECRET is not set — relying on IP allowlist for M-Pesa callbacks"
    );
  }

  if (errors.length) {
    console.error("[security] Production configuration errors:");
    for (const msg of errors) console.error(`  - ${msg}`);
    process.exit(1);
  }
}

module.exports = { loadEnv, validateProductionSecrets, MIN_JWT_SECRET_LENGTH };
