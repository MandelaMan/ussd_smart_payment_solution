/**
 * B2B customers are never invoiced individually in Zoho.
 * All billing is consolidated to the managing agency's Zoho contact.
 */

function isB2BCustomer(customer) {
  const type = String(
    customer?.customerType ?? customer?.customer_type ?? ""
  ).toUpperCase();
  return type === "B2B";
}

function getZohoContactLookupKeys(customer) {
  if (isB2BCustomer(customer)) {
    const agencyName = customer?.agencyName || customer?.agency_name;
    return agencyName ? [String(agencyName).trim()] : [];
  }

  const keys = [];
  const seen = new Set();
  const push = (value) => {
    const key = String(value || "").trim();
    if (!key) return;
    const dedupe = key.toLowerCase();
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    keys.push(key);
  };

  // Prefer customer number (company_name), then email, phone, then full name.
  push(customer?.customerNumber || customer?.customer_number);
  push(customer?.email);
  const phone = String(
    customer?.phone || customer?.mobile || customer?.phoneNumber || ""
  ).trim();
  if (phone) {
    push(phone);
    const digits = phone.replace(/\D/g, "");
    if (digits && digits !== phone) push(digits);
    if (digits.startsWith("254") && digits.length === 12) {
      push(`0${digits.slice(3)}`);
    } else if (digits.startsWith("0") && digits.length === 10) {
      push(`254${digits.slice(1)}`);
    }
  }
  const displayName = [
    customer?.firstName || customer?.first_name,
    customer?.middleName || customer?.middle_name,
    customer?.lastName || customer?.last_name,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  push(displayName);
  if (!displayName) {
    push(customer?.fullName || customer?.full_name || customer?.customerName);
  }

  return keys;
}

async function resolveAgencyForCustomer(customer, store) {
  if (!isB2BCustomer(customer)) return null;
  const agencyId = customer?.agencyId ?? customer?.agency_id;
  if (!agencyId) {
    throw new Error("B2B customer must be linked to an agency for billing");
  }
  const agency = await store.getAgencyById(Number(agencyId));
  if (!agency) {
    throw new Error("Agency not found for B2B customer billing");
  }
  return agency;
}

function filterAgencyInvoicesForCustomer(invoices, customerNumber) {
  const ref = String(customerNumber || "").trim().toUpperCase();
  if (!ref) return invoices;

  const matched = (invoices || []).filter((inv) => {
    const orderRef = String(
      inv.orderNumber || inv.reference_number || inv.referenceNumber || ""
    ).toUpperCase();
    const invoiceRef = String(inv.invoiceNumber || inv.invoice_number || "").toUpperCase();
    return orderRef.includes(ref) || invoiceRef.includes(ref);
  });

  return matched.length ? matched : invoices;
}

function b2bBillingMeta(customer, agency) {
  return {
    billedViaAgency: true,
    agencyId: agency?.id ?? customer?.agencyId ?? null,
    agencyName: agency?.name ?? customer?.agencyName ?? null,
    billingNote: agency
      ? `B2B — invoiced to agency ${agency.name}, not individually`
      : "B2B — billing is managed through the customer's agency",
  };
}

function resolveCustomerFullName(customer) {
  if (customer?.fullName) return String(customer.fullName).trim();
  return [customer?.firstName, customer?.middleName, customer?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
}

/** Skynest B2B houses were bulk-created on TISP as first/middle/last = "user". */
const SKYNEST_PLACEHOLDER_PERSON_NAME = "user";

function personNamePart(customer, camel, snake) {
  return customer?.[camel] ?? customer?.[snake] ?? "";
}

function isPlaceholderUserPersonName(value) {
  return (
    String(value || "")
      .trim()
      .toLowerCase() === SKYNEST_PLACEHOLDER_PERSON_NAME
  );
}

function isPlaceholderUserFullName(customer) {
  return (
    isPlaceholderUserPersonName(
      personNamePart(customer, "firstName", "first_name")
    ) &&
    isPlaceholderUserPersonName(
      personNamePart(customer, "middleName", "middle_name")
    ) &&
    isPlaceholderUserPersonName(personNamePart(customer, "lastName", "last_name"))
  );
}

function isSkynestLocation(customer) {
  const building = String(
    customer?.buildingName ?? customer?.building_name ?? ""
  )
    .trim()
    .toLowerCase();
  const pop = String(customer?.popName ?? customer?.pop_name ?? "")
    .trim()
    .toLowerCase();
  const number = String(
    customer?.customerNumber ?? customer?.customer_number ?? ""
  )
    .trim()
    .toUpperCase();
  const c2b = String(customer?.c2bCode ?? customer?.c2b_code ?? "")
    .trim()
    .toUpperCase();
  const b2b = String(customer?.b2bCode ?? customer?.b2b_code ?? "")
    .trim()
    .toUpperCase();
  return (
    building.includes("skynest") ||
    pop.includes("skynest") ||
    number.startsWith("SKY-") ||
    number.startsWith("SKYB-") ||
    c2b === "SKY" ||
    b2b === "SKYB"
  );
}

/**
 * Skynest B2B records named user/user/user should never use personal phone/email —
 * those fields belong to the managing agency (same contact used on TISP).
 */
function shouldUseAgencyContactForSkynestPlaceholder(customer) {
  return (
    isB2BCustomer(customer) &&
    isSkynestLocation(customer) &&
    isPlaceholderUserFullName(customer)
  );
}

function agencyEmailOf(customer, agency = null) {
  return String(
    agency?.email || customer?.agencyEmail || customer?.agency_email || ""
  ).trim();
}

function agencyPhoneOf(customer, agency = null) {
  return String(
    agency?.phone || customer?.agencyPhone || customer?.agency_phone || ""
  ).trim();
}

/** B2B TISP / service contact: personal first, agency only when the house has none. */
function resolveTispCustomerEmail(customer, agency = null) {
  return resolveEffectiveCustomerEmail(customer, agency);
}

function resolveTispCustomerPhone(customer, agency = null) {
  return resolveEffectiveCustomerPhone(customer, agency);
}

function personalCustomerEmail(customer) {
  if (shouldUseAgencyContactForSkynestPlaceholder(customer)) return "";
  const email = String(customer?.email || "").trim();
  return email.includes("@") ? email : "";
}

function personalCustomerPhone(customer) {
  if (shouldUseAgencyContactForSkynestPlaceholder(customer)) return "";
  const phone = String(customer?.phone || "").trim();
  return hasUsablePhone(phone) ? phone : "";
}

/**
 * Zoho invoices and billing collection — always the agency for B2B.
 * Residents never receive invoices on their personal address.
 */
function resolveInvoiceEmail(customer, agency = null) {
  if (isB2BCustomer(customer)) {
    const agencyEmail = agencyEmailOf(customer, agency);
    if (agencyEmail.includes("@")) return agencyEmail;
  }
  return resolveEffectiveCustomerEmail(customer, agency);
}

function resolveInvoicePhone(customer, agency = null) {
  if (isB2BCustomer(customer)) {
    const agencyPhone = agencyPhoneOf(customer, agency);
    if (hasUsablePhone(agencyPhone)) return agencyPhone;
  }
  return resolveEffectiveCustomerPhone(customer, agency);
}

/**
 * Service notices (upgrade, downgrade, apartment move, pause, etc.).
 * B2B: send to the resident when they gave a personal email, and CC the agency.
 */
function resolveOperationalEmailRecipients(customer, agency = null) {
  const personal = personalCustomerEmail(customer);
  const agencyEmail = isB2BCustomer(customer)
    ? agencyEmailOf(customer, agency)
    : "";
  const toAddress = personal || (agencyEmail.includes("@") ? agencyEmail : "");
  const ccAddresses = [];
  if (
    agencyEmail.includes("@") &&
    agencyEmail.toLowerCase() !== String(toAddress).toLowerCase()
  ) {
    ccAddresses.push(agencyEmail);
  }
  return { toAddress, ccAddresses };
}

/** B2B customers without an email fall back to the linked agency's email. */
function resolveEffectiveCustomerEmail(customer, agency = null) {
  const skipPersonal = shouldUseAgencyContactForSkynestPlaceholder(customer);
  const customerEmail = skipPersonal ? "" : String(customer?.email || "").trim();
  if (customerEmail.includes("@")) {
    return customerEmail;
  }

  if (!isB2BCustomer(customer)) {
    return customerEmail;
  }

  const agencyEmail = agencyEmailOf(customer, agency);
  return agencyEmail.includes("@") ? agencyEmail : customerEmail;
}

function hasEffectiveCustomerEmail(customer, agency = null) {
  const email = resolveEffectiveCustomerEmail(customer, agency);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hasUsablePhone(value) {
  return String(value || "").replace(/\D/g, "").length >= 9;
}

/** B2B customers without a phone fall back to the linked agency's phone. */
function resolveEffectiveCustomerPhone(customer, agency = null) {
  const skipPersonal = shouldUseAgencyContactForSkynestPlaceholder(customer);
  const customerPhone = skipPersonal ? "" : String(customer?.phone || "").trim();
  if (hasUsablePhone(customerPhone)) {
    return customerPhone;
  }

  if (!isB2BCustomer(customer)) {
    return customerPhone;
  }

  const agencyPhone = agencyPhoneOf(customer, agency);
  return hasUsablePhone(agencyPhone) ? agencyPhone : customerPhone;
}

function hasEffectiveCustomerPhone(customer, agency = null) {
  return hasUsablePhone(resolveEffectiveCustomerPhone(customer, agency));
}

/**
 * Zoho line item title for a B2B managed house: building, apartment, and package.
 */
function buildManagedHouseLineItemName(customer) {
  const { buildPackageLabel } = require("./billingPeriod");
  const parts = [];
  const building = String(customer?.buildingName || customer?.building_name || "").trim();
  const apartment = String(
    customer?.apartmentNumber || customer?.apartment_number || ""
  ).trim();
  const packageLabel = buildPackageLabel(customer);

  if (building) parts.push(building);
  if (apartment) parts.push(`Apt ${apartment}`);
  if (packageLabel) parts.push(packageLabel);

  return parts.join(" · ") || packageLabel || customer?.customerNumber || "Managed house";
}

/**
 * Zoho line item description for a B2B managed house.
 */
function buildManagedHouseLineItemDescription(customer, period) {
  const parts = [];
  const customerNumber = customer?.customerNumber || customer?.customer_number;
  const residentName = resolveCustomerFullName(customer);

  if (customerNumber) parts.push(customerNumber);
  if (residentName) parts.push(residentName);
  if (period?.startLabel && period?.endLabel) {
    parts.push(`Billing cycle: ${period.startLabel} to ${period.endLabel}`);
  }

  return parts.join(" · ") || "B2B managed house subscription";
}

/**
 * B2B recurring profile description — Zoho expands date placeholders on each invoice.
 */
function buildManagedHouseRecurringLineItemDescription(customer) {
  const {
    buildRecurringSubscriptionInvoiceDescription,
  } = require("./billingPeriod");
  const parts = [];
  const customerNumber = customer?.customerNumber || customer?.customer_number;
  const residentName = resolveCustomerFullName(customer);

  if (customerNumber) parts.push(customerNumber);
  if (residentName) parts.push(residentName);
  parts.push(
    buildRecurringSubscriptionInvoiceDescription(
      customer?.paymentFrequency || customer?.payment_frequency,
      customer?.customPeriodDays ?? customer?.custom_period_days
    )
  );

  return parts.join(" · ") || "B2B managed house subscription";
}

/**
 * Optional agency discount % from onboarding (e.g. 14.88).
 * Returns null when no discount applies.
 */
function normalizeAgencyDiscountPercent(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(100, Math.round(n * 1000) / 1000);
}

/**
 * Negotiated unit rate after agency discount.
 * Example: 6950 @ 14.88% → 5916
 */
function applyAgencyUnitDiscount(packagePrice, discountPercent) {
  const price = Math.round(Number(packagePrice) || 0);
  const pct = normalizeAgencyDiscountPercent(discountPercent);
  if (!pct || price <= 0) return price;
  return Math.round(price * (1 - pct / 100));
}

module.exports = {
  isB2BCustomer,
  getZohoContactLookupKeys,
  resolveAgencyForCustomer,
  filterAgencyInvoicesForCustomer,
  b2bBillingMeta,
  resolveCustomerFullName,
  SKYNEST_PLACEHOLDER_PERSON_NAME,
  isPlaceholderUserPersonName,
  isPlaceholderUserFullName,
  isSkynestLocation,
  shouldUseAgencyContactForSkynestPlaceholder,
  resolveTispCustomerEmail,
  resolveTispCustomerPhone,
  resolveInvoiceEmail,
  resolveInvoicePhone,
  resolveOperationalEmailRecipients,
  resolveEffectiveCustomerEmail,
  hasEffectiveCustomerEmail,
  resolveEffectiveCustomerPhone,
  hasEffectiveCustomerPhone,
  buildManagedHouseLineItemName,
  buildManagedHouseLineItemDescription,
  buildManagedHouseRecurringLineItemDescription,
  normalizeAgencyDiscountPercent,
  applyAgencyUnitDiscount,
};
