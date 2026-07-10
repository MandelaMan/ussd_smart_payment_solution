const SUBSCRIPTION_STATUSES = ["Active", "Suspended", "Unknown", "Cancelled"];

function normalizeSubscriptionStatus(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "Unknown";
  const lower = raw.toLowerCase();
  if (lower.includes("active")) return "Active";
  if (lower.includes("suspend")) return "Suspended";
  if (lower === "unknown") return "Unknown";
  return "Unknown";
}

function singleSubscriptionStatusClause(normalized) {
  if (normalized === "cancelled") {
    return "c.status = 'cancelled'";
  }
  const activeAccount = "c.status = 'active'";
  if (normalized === "active") {
    return `(${activeAccount} AND LOWER(c.subscription_status) LIKE '%active%')`;
  }
  if (normalized === "suspended") {
    return `(${activeAccount} AND LOWER(c.subscription_status) LIKE '%suspend%')`;
  }
  if (normalized === "unknown") {
    return `(${activeAccount} AND (c.subscription_status IS NULL
             OR TRIM(c.subscription_status) = ''
             OR LOWER(c.subscription_status) = 'unknown'
             OR (LOWER(c.subscription_status) NOT LIKE '%active%'
                 AND LOWER(c.subscription_status) NOT LIKE '%suspend%')))`;
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
