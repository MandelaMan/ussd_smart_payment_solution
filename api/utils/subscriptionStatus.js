const SUBSCRIPTION_STATUSES = ["Active", "Suspended", "Not on TISP", "Cancelled"];

/** Legacy DB / filter values that mean the account is not on TISP. */
const NOT_ON_TISP_ALIASES = new Set([
  "unknown",
  "not on tisp",
  "not_on_tisp",
  "missing",
  "none",
]);

function normalizeSubscriptionStatus(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "Not on TISP";
  const lower = raw.toLowerCase();
  if (lower === "active" || lower.startsWith("active ")) return "Active";
  if (lower.includes("suspend")) return "Suspended";
  if (lower.includes("cancel")) return "Cancelled";
  if (NOT_ON_TISP_ALIASES.has(lower) || lower.includes("not on tisp")) {
    return "Not on TISP";
  }
  // Anything else that isn't a known service state means not registered / not found.
  return "Not on TISP";
}

/**
 * SQL condition that matches how the UI displays status for a row:
 * Cancelled account → Cancelled; else normalize(subscription_status).
 */
function singleSubscriptionStatusClause(normalized) {
  if (normalized === "cancelled") {
    // Account cancelled, or still active but service status is cancelled.
    return `(c.status = 'cancelled'
      OR (c.status = 'active' AND LOWER(COALESCE(c.subscription_status, '')) LIKE '%cancel%'))`;
  }

  const activeAccount = "c.status = 'active'";
  if (normalized === "active") {
    return `(${activeAccount}
      AND LOWER(TRIM(COALESCE(c.subscription_status, ''))) IN ('active')
      AND LOWER(COALESCE(c.subscription_status, '')) NOT LIKE '%cancel%')`;
  }
  if (normalized === "suspended") {
    return `(${activeAccount}
      AND LOWER(COALESCE(c.subscription_status, '')) LIKE '%suspend%'
      AND LOWER(COALESCE(c.subscription_status, '')) NOT LIKE '%cancel%')`;
  }
  // "Not on TISP" (and legacy "Unknown").
  if (
    normalized === "unknown" ||
    normalized === "not on tisp" ||
    normalized === "not_on_tisp"
  ) {
    return `(${activeAccount}
      AND LOWER(COALESCE(c.subscription_status, '')) NOT LIKE '%cancel%'
      AND (
        c.subscription_status IS NULL
        OR TRIM(c.subscription_status) = ''
        OR LOWER(TRIM(c.subscription_status)) IN ('unknown', 'not on tisp', 'not_on_tisp')
        OR (
          LOWER(TRIM(c.subscription_status)) NOT IN ('active')
          AND LOWER(c.subscription_status) NOT LIKE '%suspend%'
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
