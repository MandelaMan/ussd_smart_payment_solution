const SUBSCRIPTION_STATUSES = ["Active", "Suspended", "Paused", "Cancelled"];

/** Legacy DB / filter values that mean Suspended (on Books, not actively on TISP). */
const SUSPENDED_ALIASES = new Set([
  "unknown",
  "not on tisp",
  "not_on_tisp",
  "missing",
  "none",
  "suspended",
]);

function normalizeSubscriptionStatus(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "Suspended";
  const lower = raw.toLowerCase();
  if (lower === "active" || lower.startsWith("active ")) return "Active";
  if (lower.includes("pause")) return "Paused";
  if (lower.includes("suspend")) return "Suspended";
  if (lower.includes("cancel")) return "Cancelled";
  if (
    SUSPENDED_ALIASES.has(lower) ||
    lower.includes("not on tisp") ||
    lower === "unknown"
  ) {
    return "Suspended";
  }
  // Anything else that isn't a known live service state → Suspended.
  return "Suspended";
}

/**
 * SQL condition that matches how the UI displays status for a row:
 * Cancelled account → Cancelled; else normalize(subscription_status).
 *
 * Suspended includes legacy "Not on TISP" / empty / unknown and TISP suspend.
 */
function singleSubscriptionStatusClause(normalized) {
  if (normalized === "cancelled") {
    return `(c.status = 'cancelled'
      OR (c.status = 'active' AND LOWER(COALESCE(c.subscription_status, '')) LIKE '%cancel%'))`;
  }

  const activeAccount = "c.status = 'active'";
  if (normalized === "active") {
    return `(${activeAccount}
      AND LOWER(TRIM(COALESCE(c.subscription_status, ''))) IN ('active')
      AND LOWER(COALESCE(c.subscription_status, '')) NOT LIKE '%cancel%'
      AND LOWER(COALESCE(c.subscription_status, '')) NOT LIKE '%pause%'
      AND LOWER(COALESCE(c.subscription_status, '')) NOT LIKE '%suspend%')`;
  }
  if (normalized === "paused") {
    return `(${activeAccount}
      AND LOWER(COALESCE(c.subscription_status, '')) LIKE '%pause%'
      AND LOWER(COALESCE(c.subscription_status, '')) NOT LIKE '%cancel%')`;
  }
  // Suspended = TISP suspended OR not on TISP / unknown / empty (Books customer, not live).
  if (
    normalized === "suspended" ||
    normalized === "unknown" ||
    normalized === "not on tisp" ||
    normalized === "not_on_tisp"
  ) {
    return `(${activeAccount}
      AND LOWER(COALESCE(c.subscription_status, '')) NOT LIKE '%cancel%'
      AND LOWER(COALESCE(c.subscription_status, '')) NOT LIKE '%pause%'
      AND (
        LOWER(COALESCE(c.subscription_status, '')) LIKE '%suspend%'
        OR c.subscription_status IS NULL
        OR TRIM(c.subscription_status) = ''
        OR LOWER(TRIM(c.subscription_status)) IN ('unknown', 'not on tisp', 'not_on_tisp')
        OR (
          LOWER(TRIM(c.subscription_status)) NOT IN ('active')
          AND LOWER(c.subscription_status) NOT LIKE '%suspend%'
          AND LOWER(c.subscription_status) NOT LIKE '%pause%'
        )
      ))`;
  }
  return null;
}

function subscriptionStatusFilterClause(subscriptionStatus) {
  const raw = String(subscriptionStatus || "").trim();
  if (!raw) return null;

  const parts = raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  const clauses = parts
    .map((part) => singleSubscriptionStatusClause(part))
    .filter(Boolean);

  if (!clauses.length) return null;
  if (clauses.length === 1) {
    return { sql: clauses[0], params: [] };
  }
  return { sql: `(${clauses.join(" OR ")})`, params: [] };
}

module.exports = {
  SUBSCRIPTION_STATUSES,
  normalizeSubscriptionStatus,
  subscriptionStatusFilterClause,
};
