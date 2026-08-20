/**
 * Canonical permission catalog for the admin application.
 * New modules should register permissions here — they become available
 * automatically via syncPermissionsToDb() and the admin Permissions UI.
 *
 * Keys use module.action form (e.g. customers.export).
 */

/** @typedef {{ key: string, label: string, description?: string, dangerous?: boolean }} PermissionDef */
/** @typedef {{ key: string, label: string, description?: string, permissions: PermissionDef[] }} ModuleDef */

/** @type {ModuleDef[]} */
const MODULES = [
  {
    key: "dashboard",
    label: "Dashboard",
    description: "Home dashboards and operational overviews",
    permissions: [
      { key: "dashboard.view", label: "View", description: "Access the home dashboard" },
      { key: "dashboard.finance", label: "Finance home", description: "Finance KPIs and revenue dashboard" },
      { key: "dashboard.support", label: "Support home", description: "Support / customer-ops dashboard" },
      { key: "dashboard.partner", label: "Partner home", description: "Partner-facing dashboard" },
      { key: "dashboard.executive", label: "Executive home", description: "CEO / executive dashboard" },
      { key: "dashboard.activity", label: "Activity feed", description: "View the activity / event feed" },
    ],
  },
  {
    key: "customers",
    label: "Customers",
    description: "Customer lifecycle and service management",
    permissions: [
      { key: "customers.view", label: "View", description: "List and open customer records" },
      { key: "customers.create", label: "Create", description: "Onboard new customers" },
      { key: "customers.edit", label: "Edit", description: "Update customer details and packages" },
      { key: "customers.delete", label: "Wipe local records", description: "Hard-delete cancelled customers from the admin DB (TISP/Zoho untouched)", dangerous: true },
      { key: "customers.export", label: "Export", description: "Export customer data" },
      { key: "customers.import", label: "Import", description: "Bulk-import customers" },
      { key: "customers.financials", label: "View financials", description: "View invoices, payments, and balances" },
      { key: "customers.pricing", label: "View pricing", description: "See package prices and commercial terms" },
      { key: "customers.disconnect", label: "Disconnect", description: "Disconnect customer network service" },
      { key: "customers.pause", label: "Pause / resume", description: "Pause or resume service" },
      { key: "customers.package_edit", label: "Edit package (admin)", description: "Local package corrections without Zoho invoice" },
      { key: "customers.cancel", label: "Cancel & release apartment", description: "Cancel subscription, archive identity, free apartment for reuse" },
      { key: "customers.olt", label: "OLT / ONU", description: "Link OLT equipment and view ONU status" },
    ],
  },
  {
    key: "leads",
    label: "Leads",
    description: "Prospects and lead pipeline",
    permissions: [
      { key: "leads.view", label: "View", description: "View leads and conversations" },
      { key: "leads.create", label: "Create", description: "Create prospects" },
      { key: "leads.edit", label: "Edit", description: "Update leads and add notes" },
      { key: "leads.message", label: "Send messages", description: "Send WhatsApp / email to leads" },
    ],
  },
  {
    key: "communication",
    label: "Communication",
    description: "Customer messaging channels",
    permissions: [
      { key: "communication.view", label: "View", description: "View communication channels and history" },
      { key: "communication.send", label: "Send", description: "Send customer emails / messages" },
      { key: "communication.settings", label: "Channel settings", description: "Configure email / WhatsApp integrations", dangerous: true },
    ],
  },
  {
    key: "transactions",
    label: "Transactions",
    description: "Payment and integration transaction history",
    permissions: [
      { key: "transactions.view", label: "View", description: "View unified and source transactions" },
      { key: "transactions.export", label: "Export", description: "Export transaction data" },
    ],
  },
  {
    key: "billing",
    label: "Billing & Reconciliation",
    description: "Billing reconciliation, allocations, and collections",
    permissions: [
      { key: "billing.view", label: "View", description: "View reconciliation and billing status" },
      { key: "billing.sync", label: "Sync", description: "Run billing reconciliation sync" },
      { key: "billing.allocate", label: "Allocate payments", description: "Allocate unmatched M-Pesa payments" },
      { key: "billing.actions", label: "Billing actions", description: "Execute reconciliation customer actions" },
      { key: "billing.communicate", label: "Send billing messages", description: "Send collection / billing communications" },
      { key: "billing.export", label: "Export", description: "Export reconciliation data" },
      { key: "billing.refund", label: "Refund", description: "Process refunds", dangerous: true },
      { key: "billing.reverse", label: "Reverse", description: "Reverse invoices / postings", dangerous: true },
    ],
  },
  {
    key: "analytics",
    label: "Analytics",
    description: "Business intelligence and forecasting",
    permissions: [
      { key: "analytics.view", label: "View", description: "View BI dashboards and forecasts" },
      { key: "analytics.export", label: "Export", description: "Export analytics sections" },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    description: "Operational and financial reports",
    permissions: [
      { key: "reports.view", label: "View", description: "Browse and preview reports" },
      { key: "reports.export", label: "Export / download", description: "Download report files" },
      { key: "reports.schedule", label: "Schedule", description: "Create and manage report schedules" },
    ],
  },
  {
    key: "packages",
    label: "Packages",
    description: "Product / package catalog",
    permissions: [
      { key: "packages.view", label: "View", description: "View package catalog" },
      { key: "packages.create", label: "Create", description: "Create packages" },
      { key: "packages.edit", label: "Edit", description: "Edit packages" },
      { key: "packages.delete", label: "Delete", description: "Delete packages", dangerous: true },
    ],
  },
  {
    key: "buildings",
    label: "Buildings",
    description: "Building and OLT configuration",
    permissions: [
      { key: "buildings.view", label: "View", description: "View buildings and OLTs" },
      { key: "buildings.create", label: "Create", description: "Create buildings / OLTs" },
      { key: "buildings.edit", label: "Edit", description: "Edit buildings / OLTs" },
      { key: "buildings.delete", label: "Delete", description: "Delete OLT records", dangerous: true },
    ],
  },
  {
    key: "pops",
    label: "POPs",
    description: "Points of presence",
    permissions: [
      { key: "pops.view", label: "View", description: "View POPs and POP OLTs" },
      { key: "pops.create", label: "Create", description: "Create POPs / OLTs" },
      { key: "pops.edit", label: "Edit", description: "Edit POPs / OLTs" },
      { key: "pops.delete", label: "Delete", description: "Delete POP OLTs", dangerous: true },
    ],
  },
  {
    key: "apartments",
    label: "Apartments",
    description: "Apartment units and occupancy history",
    permissions: [
      { key: "apartments.view", label: "View", description: "View apartments and history" },
      { key: "apartments.edit", label: "Edit", description: "Manage apartment occupancy data" },
    ],
  },
  {
    key: "installations",
    label: "Installations",
    description: "Field installation jobs for new customers and apartment moves",
    permissions: [
      { key: "installations.view", label: "View", description: "View installation jobs and schedules" },
      { key: "installations.assign", label: "Assign", description: "Assign or reassign technicians" },
      { key: "installations.edit", label: "Update", description: "Update installation status and notes" },
    ],
  },
  {
    key: "action_items",
    label: "Reminders",
    description: "Customer action items, tagged-user notifications, and follow-up checklists",
    permissions: [
      { key: "action_items.view", label: "View", description: "View reminders and action items" },
      { key: "action_items.create", label: "Create", description: "Create reminders and tag users" },
      { key: "action_items.assign", label: "Assign", description: "Tag or retag users on an action item" },
      { key: "action_items.edit", label: "Update", description: "Update status, checklist steps, and notes" },
    ],
  },
  {
    key: "campaigns",
    label: "Campaigns",
    description: "Acquisition campaigns, first-month discounts, and referrals",
    permissions: [
      { key: "campaigns.view", label: "View", description: "View campaigns and metrics" },
      { key: "campaigns.create", label: "Create", description: "Create campaigns (administrator only)", dangerous: true },
      { key: "campaigns.edit", label: "Edit", description: "Edit campaign dates, discounts, and status (administrator only)", dangerous: true },
    ],
  },
  {
    key: "agencies",
    label: "Agencies",
    description: "Agency partners and agency billing",
    permissions: [
      { key: "agencies.view", label: "View", description: "View agencies and invoices" },
      { key: "agencies.create", label: "Create", description: "Create agencies and invoices" },
      { key: "agencies.edit", label: "Edit", description: "Edit agencies" },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    description: "Application configuration",
    permissions: [
      { key: "settings.view", label: "View", description: "View settings" },
      { key: "settings.edit", label: "Edit", description: "Change system settings", dangerous: true },
      { key: "settings.sync", label: "Synchronization", description: "Access synchronization tools" },
    ],
  },
  {
    key: "system_logs",
    label: "System Logs",
    description: "Integration and API logs",
    permissions: [
      { key: "system_logs.view", label: "View", description: "View system / API logs" },
      { key: "system_logs.retry", label: "Retry", description: "Retry failed log entries" },
    ],
  },
  {
    key: "users",
    label: "User Management",
    description: "Admin users, groups, and permissions",
    permissions: [
      { key: "users.view", label: "View", description: "View users and groups" },
      { key: "users.create", label: "Create users", description: "Create admin users" },
      { key: "users.edit", label: "Edit users", description: "Edit user profile, role, groups, and status" },
      { key: "users.disable", label: "Disable users", description: "Activate or disable accounts" },
      { key: "users.delete", label: "Delete users", description: "Permanently remove users", dangerous: true },
      { key: "users.reset_password", label: "Reset passwords", description: "Reset user passwords" },
      { key: "users.manage_permissions", label: "Manage permissions", description: "Override user and group permissions", dangerous: true },
      { key: "users.manage_groups", label: "Manage groups", description: "Create and configure user groups", dangerous: true },
    ],
  },
];

/** Flat list of all permission keys. */
function allPermissionKeys() {
  return MODULES.flatMap((m) => m.permissions.map((p) => p.key));
}

/** @type {Map<string, PermissionDef & { moduleKey: string, moduleLabel: string }>} */
const PERMISSION_INDEX = new Map();
for (const mod of MODULES) {
  for (const perm of mod.permissions) {
    PERMISSION_INDEX.set(perm.key, {
      ...perm,
      moduleKey: mod.key,
      moduleLabel: mod.label,
    });
  }
}

function getPermission(key) {
  return PERMISSION_INDEX.get(key) || null;
}

/**
 * Baseline for the User system role: authenticated, nothing else.
 * Operational access comes only from groups and individual grants.
 * Do not put module access here — groups cannot subtract role defaults.
 *
 * When narrowing GROUP_PRESETS, bump SYSTEM_GROUP_PRESET_REVISION so existing
 * databases replace system-group grants on next boot.
 */
const SYSTEM_GROUP_PRESET_REVISION = 2;

const USER_ROLE_DEFAULTS = Object.freeze(["dashboard.view"]);

/**
 * Preset groups — seeded on migration / sync. Slugs are stable identifiers.
 * @type {{ slug: string, name: string, description: string, permissions: string[] }[]}
 */
const GROUP_PRESETS = [
  {
    slug: "sales",
    name: "Sales",
    description: "Customer acquisition and lead pipeline",
    permissions: [
      "dashboard.view",
      "dashboard.support",
      "customers.view",
      "customers.create",
      "customers.edit",
      "customers.pricing",
      "leads.view",
      "leads.create",
      "leads.edit",
      "leads.message",
      "communication.view",
      "communication.send",
      "reports.view",
      "campaigns.view",
      "installations.view",
      "action_items.view",
      "action_items.create",
      "action_items.assign",
      "action_items.edit",
    ],
  },
  {
    slug: "finance",
    name: "Finance",
    description:
      "Financial operations, billing, and reconciliation. Refunds are not included — grant billing.refund individually.",
    permissions: [
      "dashboard.view",
      "dashboard.finance",
      "dashboard.activity",
      "customers.view",
      "customers.financials",
      "customers.pricing",
      "customers.export",
      "transactions.view",
      "transactions.export",
      "billing.view",
      "billing.sync",
      "billing.allocate",
      "billing.actions",
      "billing.communicate",
      "billing.export",
      "analytics.view",
      "analytics.export",
      "reports.view",
      "reports.export",
      "reports.schedule",
      "agencies.view",
      "campaigns.view",
      "action_items.view",
      "action_items.create",
      "action_items.edit",
    ],
  },
  {
    slug: "support",
    name: "Support",
    description:
      "Customer support and service management. Cancel, disconnect, and agency management are not included.",
    permissions: [
      "dashboard.view",
      "dashboard.support",
      "dashboard.activity",
      "customers.view",
      "customers.create",
      "customers.edit",
      "customers.financials",
      "customers.pause",
      "customers.olt",
      "leads.view",
      "leads.create",
      "leads.edit",
      "leads.message",
      "communication.view",
      "communication.send",
      "packages.view",
      "buildings.view",
      "apartments.view",
      "reports.view",
      "installations.view",
      "installations.assign",
      "installations.edit",
      "action_items.view",
      "action_items.create",
      "action_items.assign",
      "action_items.edit",
    ],
  },
  {
    slug: "network-operations",
    name: "Network Operations",
    description: "Equipment, connection status, and fault management",
    permissions: [
      "dashboard.view",
      "dashboard.support",
      "customers.view",
      "customers.edit",
      "customers.disconnect",
      "customers.pause",
      "customers.olt",
      "buildings.view",
      "buildings.edit",
      "pops.view",
      "pops.edit",
      "apartments.view",
      "packages.view",
      "installations.view",
      "installations.assign",
      "installations.edit",
      "action_items.view",
      "action_items.create",
      "action_items.assign",
      "action_items.edit",
    ],
  },
  {
    slug: "technician",
    name: "Technician",
    description: "Field installation jobs — auto-assigned when a slot is booked",
    permissions: [
      "dashboard.view",
      "dashboard.support",
      "customers.view",
      "buildings.view",
      "apartments.view",
      "installations.view",
      "installations.edit",
      "action_items.view",
      "action_items.edit",
    ],
  },
  {
    slug: "management",
    name: "Management",
    description: "Executive reports, analytics, and revenue oversight (read)",
    permissions: [
      "dashboard.view",
      "dashboard.executive",
      "dashboard.finance",
      "dashboard.activity",
      "customers.view",
      "customers.financials",
      "customers.pricing",
      "customers.export",
      "transactions.view",
      "transactions.export",
      "billing.view",
      "billing.export",
      "analytics.view",
      "analytics.export",
      "reports.view",
      "reports.export",
      "reports.schedule",
      "agencies.view",
      "campaigns.view",
      "leads.view",
      "installations.view",
      "action_items.view",
    ],
  },
  {
    slug: "installations",
    name: "Installations",
    description:
      "Field onboarding jobs and occupancy. Does not grant building or POP create/edit.",
    permissions: [
      "dashboard.view",
      "dashboard.support",
      "customers.view",
      "customers.create",
      "customers.edit",
      "customers.olt",
      "buildings.view",
      "apartments.view",
      "apartments.edit",
      "installations.view",
      "installations.assign",
      "installations.edit",
      "action_items.view",
      "action_items.create",
      "action_items.assign",
      "action_items.edit",
    ],
  },
  {
    slug: "customer-relations",
    name: "Customer Relations",
    description: "Partner / limited customer visibility (no financials)",
    permissions: [
      "dashboard.view",
      "dashboard.partner",
      "customers.view",
      "reports.view",
      "reports.export",
    ],
  },
  {
    slug: "billing",
    name: "Billing",
    description: "Collections, allocations, and billing communications",
    permissions: [
      "dashboard.view",
      "dashboard.finance",
      "customers.view",
      "customers.financials",
      "customers.pricing",
      "transactions.view",
      "billing.view",
      "billing.allocate",
      "billing.actions",
      "billing.communicate",
      "billing.export",
      "reports.view",
      "reports.export",
      "action_items.view",
      "action_items.create",
      "action_items.edit",
    ],
  },
];

/** Map legacy roles → group slug(s) for migration. */
const LEGACY_ROLE_GROUPS = Object.freeze({
  support: ["support"],
  cfo: ["finance"],
  ceo: ["management"],
  partner: ["customer-relations"],
  viewer: ["support"],
});

module.exports = {
  MODULES,
  USER_ROLE_DEFAULTS,
  SYSTEM_GROUP_PRESET_REVISION,
  GROUP_PRESETS,
  LEGACY_ROLE_GROUPS,
  allPermissionKeys,
  getPermission,
  PERMISSION_INDEX,
};
