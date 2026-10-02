export type VersionEntry = {
  version: string;
  date: string;
  title: string;
  features: string[];
};

/** Product versioning log — feature releases only (newest first). */
export const VERSION_LOG: VersionEntry[] = [
  {
    version: "1.23.0",
    date: "2026-09-24",
    title: "Customer cancellation report",
    features: [
      "Customer Cancellation Report lists cancelled customers with contact, premise, package, equipment collection dates, and move-out reason",
    ],
  },
  {
    version: "1.22.0",
    date: "2026-09-18",
    title: "IPTV disconnect and reconnect call Startlyx",
    features: [
      "Disconnect cancels the user's active Startlyx subscription and ends live sessions; reconnect re-subscribes the same Startlyx user to their last package",
      "The status shown after disconnect or reconnect is read back from Startlyx instead of assumed",
    ],
  },
  {
    version: "1.21.0",
    date: "2026-09-16",
    title: "Activity and IPTV permissions",
    features: [
      "Activity and IPTV appear in Users & permissions so access can be granted like other modules, instead of being administrator-only",
      "IPTV view, operate, and connection settings can be allocated separately",
    ],
  },
  {
    version: "1.20.0",
    date: "2026-09-16",
    title: "IPTV connection settings",
    features: [
      "Startlyx URL, admin email, and password are saved under Settings → IPTV and used by the IPTV console — no server .env restart required",
    ],
  },
  {
    version: "1.19.0",
    date: "2026-09-16",
    title: "Apartment and shop packages",
    features: [
      "Building prices are created as apartment or shop packages, and customers only see matching prices",
    ],
  },
  {
    version: "1.18.0",
    date: "2026-09-15",
    title: "IPTV test user disconnect and reconnect",
    features: [
      "Disconnect a Startlyx test subscriber by cancelling the active package, then reconnect by assigning it again",
      "Pause days can be used in shorter stays, with the remaining balance shown until the allowance is exhausted",
    ],
  },
  {
    version: "1.17.0",
    date: "2026-09-14",
    title: "Admin IPTV console",
    features: [
      "Administrator-only IPTV module to test Startlyx: create a remote user, assign a package, and inspect live channel status",
    ],
  },
  {
    version: "1.16.0",
    date: "2026-09-11",
    title: "Partner types: Investor, DSTV, Internet",
    features: [
      "Partner access splits into Investor, DSTV Partner, and Internet Partner groups — all view-only",
      "DSTV partners only see DSTV subscribers on customers, dashboards, and reports",
      "Investors keep all customers with reports and analytics as the primary workspace",
    ],
  },
  {
    version: "1.15.0",
    date: "2026-08-26",
    title: "Self-serve staff password reset",
    features: [
      "Staff request a time-limited reset link from the login page instead of waiting on IT",
      "Completing a reset unlocks a lockout from failed sign-in attempts",
      "Admins can send a reset link or unlock an account from Users, with temporary passwords as a fallback",
    ],
  },
  {
    version: "1.14.0",
    date: "2026-08-21",
    title: "Public signup & admin hardening",
    features: [
      "Public signup form lands in Leads as Interested — pending conversion until staff verify",
      "Customer numbers reused for a new tenant after cancel (TISP update, new Zoho contact)",
      "Paused accounts credit unused away days onto the next subscription, shown on the customer record",
      "Concurrent admin session limits per account with oldest-device revocation",
      "Staff account-recovery requests logged and emailed to the recovery inbox",
    ],
  },
  {
    version: "1.13.0",
    date: "2026-08-18",
    title: "Installations, reminders & push",
    features: [
      "Installation jobs created at customer onboard and apartment switch",
      "Reminders workspace with assignees, due dates, and an activity trail",
      "In-app notification bell and optional PWA web-push alerts",
    ],
  },
  {
    version: "1.12.0",
    date: "2026-08-14",
    title: "Campaigns & referrals",
    features: [
      "Acquisition campaigns with first-month package discount at onboard",
      "Referral rewards tracked against campaigns",
      "Concurrent campaigns with priority and pause without ending the date window",
    ],
  },
  {
    version: "1.11.0",
    date: "2026-08-08",
    title: "Permission-driven access",
    features: [
      "Administrator and User system roles with group-based permissions",
      "Preset groups for Sales, Finance, Billing, Support, Technician, and more",
      "Individual grant/deny overrides and a permission audit trail",
    ],
  },
  {
    version: "1.10.0",
    date: "2026-08-06",
    title: "POPs, shops & DSTV-only",
    features: [
      "POPs as the parent of buildings, with optional per-building customer-number codes",
      "Shops as units under the same building and POP as apartments",
      "DSTV-only plans billed in Zoho without TISP or bandwidth provisioning",
    ],
  },
  {
    version: "1.9.0",
    date: "2026-08-05",
    title: "Settings, activity & billing address",
    features: [
      "App settings stored in the database and editable from the admin workspace",
      "Customer and building billing addresses synced to Zoho Books contacts",
      "Activity feed entries attributed to the admin who performed the action",
    ],
  },
  {
    version: "1.8.0",
    date: "2026-07-29",
    title: "Customer communication",
    features: [
      "Communication module for outbound and inbound customer messaging",
      "WhatsApp channel for active customers alongside lead prospecting",
      "Conversation history surfaced from the admin workspace",
    ],
  },
  {
    version: "1.7.0",
    date: "2026-07-23",
    title: "Network credentials on customers",
    features: [
      "PPPoE username and password stored and editable on customer records",
      "Credentials visible in customer detail for support and field ops",
      "Synced with TISP account updates when network identity changes",
    ],
  },
  {
    version: "1.6.0",
    date: "2026-07-23",
    title: "Expanded package catalog",
    features: [
      "Additional package categories for clearer plan grouping",
      "New product plans available for signup, upgrade, and downgrade",
      "Catalog-driven pricing for USSD and admin package changes",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-07-17",
    title: "Customer lifecycle operations",
    features: [
      "Upgrade and downgrade flows with prorated Zoho invoicing and credits",
      "Pause, suspend, cancel, and apartment-move actions from the customer menu",
      "C2B ↔ B2B conversion with account migration across TISP and Zoho",
      "Billing frequency changes mapped to matching Mbps products",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-07-15",
    title: "Property, partners & leads",
    features: [
      "Buildings, apartments, and apartment history ledgers",
      "Agency (B2B partner) management with agency-level invoicing",
      "Public lead intake form, embeddable widget, and WhatsApp prospect webhook",
      "Leads inbox for prospect follow-up in the admin panel",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-07-10",
    title: "Role dashboards & analytics",
    features: [
      "Role-home dashboards for Admin, CFO, CEO, Partner, and Support",
      "Business intelligence charts and KPI views for finance roles",
      "Reports workspace for operational and partner reporting",
      "Mobile-friendly admin navigation and login experience",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-07-02",
    title: "Paybill simulation & live process guides",
    features: [
      "Paybill-to-Zoho simulation for end-to-end payment rehearsals",
      "Operator instructions and live-process guidance in the admin panel",
      "Safer dry-run paths before applying payments in production",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-06-24",
    title: "Billing reconciliation workspace",
    features: [
      "Billing module with overview, gap detection, and manual-review queues",
      "Unallocated M-Pesa matching against customer invoices",
      "Recurring-invoice and missing-invoice discovery tools",
      "Billing communications for customer payment outreach",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-06-22",
    title: "Admin utility panel",
    features: [
      "Full React admin console for customers, packages, transactions, and settings",
      "Role-based access for Administrator, CFO, CEO, Support, and Partner",
      "Users & permissions, webhook configuration, and synchronization controls",
      "Activity feed and searchable server logs for operations",
    ],
  },
  {
    version: "0.9.0",
    date: "2026-06-19",
    title: "Xtream IPTV sync",
    features: [
      "Xtream Codes integration for IPTV bouquet provisioning",
      "Optional sync toggle from admin settings and environment flags",
      "Smoke-test coverage for Xtream API connectivity",
    ],
  },
  {
    version: "0.8.0",
    date: "2026-06-17",
    title: "Background sync platform",
    features: [
      "BullMQ workers and Redis-backed job queues for Zoho and TISP sync",
      "Incremental Zoho sync with rate-limit-aware scheduling",
      "Live sync progress in the admin synchronization tab",
    ],
  },
  {
    version: "0.6.0",
    date: "2026-04-08",
    title: "Invoice automation & package fetch",
    features: [
      "Zoho package catalog fetched for USSD and payment flows",
      "Automatic invoice creation with duplicate-invoice guards",
      "Invoice marked paid when M-Pesa confirmation completes",
      "Customer due-date handling on TISP after successful payment",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-02-05",
    title: "Dual-system customer resolution",
    features: [
      "USSD customers resolved against both Zoho Books and TISP",
      "Dedicated handlers when a subscriber is missing in either system",
      "Account-detail screens for support during USSD sessions",
    ],
  },
  {
    version: "0.3.0",
    date: "2025-10-30",
    title: "Zoho Books & TISP bridge",
    features: [
      "Zoho Books controller for contacts, invoices, and recurring billing",
      "Combined Zoho and TISP customer lookups in a single payment path",
      "TISP billing URL integration for ISP account updates",
    ],
  },
  {
    version: "0.2.0",
    date: "2025-10-27",
    title: "M-Pesa payment rails",
    features: [
      "M-Pesa STK Push initiation from USSD",
      "C2B confirmation and validation callbacks",
      "B2C result and timeout webhook endpoints",
      "Transaction writer and persistent payment logging",
    ],
  },
  {
    version: "0.1.0",
    date: "2025-10-24",
    title: "USSD smart payment foundation",
    features: [
      "USSD menu for self-service payments and account actions",
      "Session handling for dial-in subscribers",
      "Upgrade and downgrade entry points from the USSD tree",
      "Environment and process setup for hosted deployments",
    ],
  },
];

export const CURRENT_APP_VERSION = VERSION_LOG[0]?.version ?? "0.0.0";
