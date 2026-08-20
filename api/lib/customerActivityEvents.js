/**
 * Customer lifecycle activity events shown in Recent Activity.
 * Keep in sync with admin/src/lib/activityFeed.ts
 */

/** Everyday customer ops — visible to anyone with dashboard.activity. */
const CUSTOMER_ACTIVITY_EVENT_TYPES = Object.freeze([
  "customer_created",
  "customer_created_tisp_failed",
  "customer_created_zoho_failed",
  "customer_imported",
  "customer_imported_tisp_failed",
  "customer_updated",
  "customer_upgraded",
  "customer_downgraded",
  "customer_frequency_changed",
  "customer_apartment_switched",
  "installation_assigned",
  "installation_updated",
  "customer_type_changed",
  "customer_paused",
  "tisp_reconnected",
  "tisp_reconnect_failed",
  // Sensitive — also listed below; included so admins/authorized roles see a full timeline
  "customer_disconnected",
  "customer_cancelled",
  "customer_deleted",
]);

/** Admin Activity audit only — not shown on the team Recent Activity rail. */
const ADMIN_AUDIT_EXTRA_EVENT_TYPES = Object.freeze([
  "user_login",
  "user_recovery_requested",
  "user_impersonation_started",
  "user_impersonation_stopped",
]);

const ADMIN_AUDIT_EVENT_TYPES = Object.freeze([
  ...CUSTOMER_ACTIVITY_EVENT_TYPES,
  ...ADMIN_AUDIT_EXTRA_EVENT_TYPES,
]);

/**
 * High-impact / destructive menu actions.
 * Visible only when the viewer has the matching permission (admins typically have all).
 */
const SENSITIVE_ACTIVITY_PERMISSIONS = Object.freeze({
  customer_disconnected: "customers.disconnect",
  customer_cancelled: "customers.cancel",
  customer_deleted: "customers.delete",
});

const SENSITIVE_ACTIVITY_EVENT_TYPES = Object.freeze(
  Object.keys(SENSITIVE_ACTIVITY_PERMISSIONS)
);

/**
 * @param {Iterable<string> | Set<string> | null | undefined} permissionSet
 * @param {{ isAdmin?: boolean }} [opts]
 * @returns {string[]}
 */
function visibleCustomerActivityTypes(permissionSet, opts = {}) {
  if (opts.isAdmin) {
    return [...CUSTOMER_ACTIVITY_EVENT_TYPES];
  }

  const set =
    permissionSet instanceof Set
      ? permissionSet
      : new Set(Array.isArray(permissionSet) ? permissionSet : []);

  return CUSTOMER_ACTIVITY_EVENT_TYPES.filter((eventType) => {
    const required = SENSITIVE_ACTIVITY_PERMISSIONS[eventType];
    if (!required) return true;
    return set.has(required);
  });
}

module.exports = {
  CUSTOMER_ACTIVITY_EVENT_TYPES,
  ADMIN_AUDIT_EXTRA_EVENT_TYPES,
  ADMIN_AUDIT_EVENT_TYPES,
  SENSITIVE_ACTIVITY_EVENT_TYPES,
  SENSITIVE_ACTIVITY_PERMISSIONS,
  visibleCustomerActivityTypes,
};
