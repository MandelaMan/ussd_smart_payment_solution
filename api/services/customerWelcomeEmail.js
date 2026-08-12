/**
 * Configurable lifecycle emails to customers (welcome, upgrade, move, etc.).
 */
const {
  getCustomerEmailSettings,
  CUSTOMER_EMAIL_TEMPLATE_DEFS,
  CUSTOMER_EMAIL_TEMPLATE_KEYS,
} = require("./appSettingsStore");
const {
  sendZohoMail,
  isZohoMailConfigured,
  loadMailIdentity,
} = require("../utils/zohoMail");
const { resolveEffectiveCustomerEmail } = require("../utils/b2bBilling");
const customerEmailStore = require("./customerEmailStore");
const { logActivity } = require("./activityLogStore");

const PLACEHOLDER_KEYS = [
  "firstName",
  "lastName",
  "fullName",
  "customerNumber",
  "email",
  "phone",
  "buildingName",
  "apartmentNumber",
  "productName",
  "productMbps",
  "paymentFrequency",
  "packagePrice",
  "previousProductName",
  "previousMbps",
  "previousApartment",
  "previousCustomerNumber",
  "cancellationReason",
  "pauseStartDate",
  "pauseEndDate",
  "pauseReason",
  "trialEndsAt",
  "referralDiscountPercent",
  "referralDiscountedPrice",
  "referredCustomerNumber",
  "referredCustomerName",
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function applyTemplate(template, vars, { escape = false } = {}) {
  let out = String(template || "");
  for (const key of PLACEHOLDER_KEYS) {
    const raw = vars[key] != null ? String(vars[key]) : "";
    const value = escape ? escapeHtml(raw) : raw;
    out = out.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "gi"), value);
  }
  return out;
}

function formatKes(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  return `KES ${n.toLocaleString("en-KE")}`;
}

function buildCustomerTemplateVars(customer, extra = {}) {
  const firstName = String(customer?.firstName || "").trim();
  const lastName = String(customer?.lastName || "").trim();
  const fullName =
    String(customer?.fullName || "").trim() ||
    [firstName, lastName].filter(Boolean).join(" ");
  const toAddress = resolveEffectiveCustomerEmail(customer);
  const packagePriceRaw =
    extra.packagePrice != null
      ? extra.packagePrice
      : customer?.packagePrice != null
        ? customer.packagePrice
        : "";

  const base = {
    firstName: firstName || fullName.split(" ")[0] || "Customer",
    lastName,
    fullName: fullName || "Customer",
    customerNumber: String(customer?.customerNumber || "").trim(),
    email: toAddress || String(customer?.email || "").trim(),
    phone: String(customer?.phone || customer?.agencyPhone || "").trim(),
    buildingName: String(customer?.buildingName || "").trim(),
    apartmentNumber: String(customer?.apartmentNumber || "").trim(),
    productName: String(
      extra.productName != null ? extra.productName : customer?.productName || ""
    ).trim(),
    productMbps: String(
      extra.productMbps != null
        ? extra.productMbps
        : customer?.productMbps != null
          ? customer.productMbps
          : ""
    ).trim(),
    paymentFrequency: String(
      extra.paymentFrequency != null
        ? extra.paymentFrequency
        : customer?.paymentFrequency || ""
    ).trim(),
    packagePrice: "",
    previousProductName: "",
    previousMbps: "",
    previousApartment: "",
    previousCustomerNumber: "",
    cancellationReason: "",
    pauseStartDate: "",
    pauseEndDate: "",
    pauseReason: "",
    trialEndsAt: String(
      extra.trialEndsAt != null
        ? extra.trialEndsAt
        : customer?.trialEndsAt || ""
    )
      .trim()
      .slice(0, 10),
    referralDiscountPercent: "",
    referralDiscountedPrice: "",
    referredCustomerNumber: "",
    referredCustomerName: "",
    toAddress,
  };

  if (
    typeof packagePriceRaw === "number" ||
    (packagePriceRaw !== "" &&
      packagePriceRaw != null &&
      !String(packagePriceRaw).startsWith("KES"))
  ) {
    base.packagePrice = formatKes(packagePriceRaw);
  } else {
    base.packagePrice = String(packagePriceRaw || "").trim();
  }

  if (
    extra.referralDiscountedPrice != null &&
    extra.referralDiscountedPrice !== "" &&
    !String(extra.referralDiscountedPrice).startsWith("KES")
  ) {
    base.referralDiscountedPrice = formatKes(extra.referralDiscountedPrice);
  }

  for (const key of PLACEHOLDER_KEYS) {
    if (extra[key] != null && extra[key] !== "") {
      if (key === "packagePrice" && !String(extra[key]).startsWith("KES")) {
        base.packagePrice = formatKes(extra[key]);
      } else {
        base[key] = String(extra[key]).trim();
      }
    }
  }

  return base;
}

function wrapLifecycleHtml(bodyHtml) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1a1a1a;line-height:1.5;max-width:600px">
${bodyHtml}
</body></html>`;
}

/**
 * Best-effort lifecycle email. Never throws for missing config / recipient.
 */
async function sendCustomerLifecycleEmail(
  templateKey,
  customer,
  { createdBy = null, extraVars = {} } = {}
) {
  if (!CUSTOMER_EMAIL_TEMPLATE_DEFS[templateKey]) {
    return { ok: false, skipped: true, reason: "unknown_template" };
  }
  if (!customer) {
    return { ok: false, skipped: true, reason: "no_customer" };
  }

  let settings;
  try {
    settings = await getCustomerEmailSettings();
  } catch (e) {
    console.warn(`${templateKey} email settings lookup failed:`, e.message);
    return {
      ok: false,
      skipped: true,
      reason: "settings_error",
      error: e.message,
    };
  }

  const template = settings.templates?.[templateKey];
  if (!template?.enabled) {
    return { ok: false, skipped: true, reason: "disabled" };
  }

  if (!isZohoMailConfigured()) {
    return { ok: false, skipped: true, reason: "mail_not_configured" };
  }

  const vars = buildCustomerTemplateVars(customer, extraVars);
  const toAddress = vars.toAddress;
  if (!toAddress || !toAddress.includes("@")) {
    return { ok: false, skipped: true, reason: "no_email" };
  }

  const label =
    CUSTOMER_EMAIL_TEMPLATE_DEFS[templateKey].label || templateKey;
  const subject = applyTemplate(template.subject, vars);
  const bodyInner = applyTemplate(template.bodyHtml, vars, { escape: false });
  const content = wrapLifecycleHtml(bodyInner);
  const ccAddress = (template.ccEmails || []).join(",");

  try {
    const identity = await loadMailIdentity();
    const result = await sendZohoMail({
      toAddress,
      subject,
      content,
      ccAddress: ccAddress || undefined,
      mailFormat: "html",
    });

    try {
      await customerEmailStore.createMessage({
        customerId: customer.id,
        direction: "outbound",
        fromAddress: identity.fromAddress,
        toAddress,
        subject,
        bodyHtml: content,
        zohoMessageId: result?.messageId || null,
        status: "sent",
        createdBy,
      });
    } catch {
      /* local history optional */
    }

    try {
      await logActivity({
        eventType: `customer_${templateKey}_email`,
        title: `${label} email sent`,
        message: `${label} email to ${toAddress} for ${vars.customerNumber}`,
        source: "admin",
        status: "success",
        customerRef: vars.customerNumber || String(customer.id),
        metadata: {
          templateKey,
          toAddress,
          subject,
          messageId: result?.messageId || null,
          cc: template.ccEmails || [],
        },
      });
    } catch {
      /* activity optional */
    }

    return {
      ok: true,
      templateKey,
      toAddress,
      subject,
      messageId: result?.messageId || null,
    };
  } catch (e) {
    console.warn(
      `${templateKey} email failed for customer ${customer.id}:`,
      e.message
    );
    try {
      await logActivity({
        eventType: `customer_${templateKey}_email`,
        title: `${label} email failed`,
        message: e.message || `Failed to send ${label} email`,
        source: "admin",
        status: "failed",
        customerRef: vars.customerNumber || String(customer.id),
        metadata: { templateKey, toAddress, error: e.message },
      });
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      templateKey,
      error: e.message || `${label} email failed`,
    };
  }
}

async function sendCustomerWelcomeEmail(customer, options = {}) {
  const results = [];
  const welcome = await sendCustomerLifecycleEmail("welcome", customer, options);
  results.push(welcome);

  const trialOn =
    customer?.trialPeriodEnabled === true ||
    customer?.trialPeriod === true ||
    Boolean(customer?.trialEndsAt);
  if (trialOn) {
    results.push(
      await sendCustomerLifecycleEmail("trial_started", customer, {
        ...options,
        extraVars: {
          trialEndsAt: customer.trialEndsAt || options.extraVars?.trialEndsAt,
          ...(options.extraVars || {}),
        },
      })
    );
  }

  return {
    ok: results.some((r) => r.ok),
    results,
    ...(welcome.ok ? welcome : results.find((r) => r.ok) || welcome),
  };
}

module.exports = {
  sendCustomerLifecycleEmail,
  sendCustomerWelcomeEmail,
  applyTemplate,
  buildCustomerTemplateVars,
  buildWelcomeVars: buildCustomerTemplateVars,
  PLACEHOLDER_KEYS,
  wrapWelcomeHtml: wrapLifecycleHtml,
  wrapLifecycleHtml,
  CUSTOMER_EMAIL_TEMPLATE_KEYS,
};
