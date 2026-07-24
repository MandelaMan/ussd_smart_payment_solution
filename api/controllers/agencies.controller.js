const store = require("../services/customerModuleStore");
const {
  computeBillingPeriod,
  computeInvoiceDueDate,
} = require("../utils/billingPeriod");
const {
  buildManagedHouseLineItemName,
  buildManagedHouseLineItemDescription,
  normalizeAgencyDiscountPercent,
  applyAgencyUnitDiscount,
} = require("../utils/b2bBilling");
const { logActivity } = require("../services/activityLogStore");
const {
  getCustomerByCompanyName_JS,
  createContact_JS,
  updateContact_JS,
  createInvoice_JS,
  getInvoices_JS,
} = require("./zoho.controller");
const { summarizeOverdueZohoInvoices } = require("../utils/zohoInvoiceStatus");

const ZOHO_INVOICE_TAX_INCLUSIVE =
  String(process.env.ZOHO_INVOICE_TAX_INCLUSIVE || "true").toLowerCase() !==
  "false";
const ZOHO_VAT_TAX_ID = process.env.ZOHO_VAT_TAX_ID || null;

function formatZohoPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return undefined;
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

function formatCurrency(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "KES 0";
  return `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
}

function computeAgencyBilling(customers, discountPercent = null) {
  const active = customers.filter((c) => c.status === "active");
  const pct = normalizeAgencyDiscountPercent(discountPercent);
  const totalActiveAmount = active.reduce(
    (sum, c) => sum + Number(c.packagePrice || 0),
    0
  );
  const totalInvoiceAmount = active.reduce(
    (sum, c) => sum + applyAgencyUnitDiscount(c.packagePrice, pct),
    0
  );
  return {
    totalCustomers: customers.length,
    activeCustomers: active.length,
    cancelledCustomers: customers.length - active.length,
    totalActiveAmount,
    discountPercent: pct,
    totalInvoiceAmount,
  };
}

function mapZohoInvoice(inv) {
  return {
    id: String(inv.invoice_id),
    invoiceNumber: inv.invoice_number || null,
    orderNumber:
      inv.order_number ||
      inv.salesorder_number ||
      inv.reference_number ||
      null,
    date: inv.date || null,
    dueDate: inv.due_date || null,
    status: inv.status || "unknown",
    total: inv.total != null ? Number(inv.total) : null,
    balanceDue: inv.balance != null ? Number(inv.balance) : null,
    currency: inv.currency_code || "KES",
  };
}

async function findZohoContactForAgency(agency) {
  const result = await getCustomerByCompanyName_JS(agency.name);
  if (
    result &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    result.contact_id
  ) {
    return result;
  }
  return null;
}

function buildAgencyZohoContactPayload(agency) {
  const phone = formatZohoPhone(agency.phone);
  const payload = {
    contact_name: agency.name,
    company_name: agency.name,
    contact_type: "customer",
    customer_sub_type: "business",
    email: agency.email ? String(agency.email).trim() : undefined,
  };
  if (phone) {
    payload.phone = phone;
    payload.mobile = phone;
  }
  if (agency.contactPerson) {
    payload.contact_persons = [
      {
        first_name: String(agency.contactPerson).trim(),
        last_name: agency.name,
        email: payload.email,
        phone,
        mobile: phone,
        is_primary_contact: true,
      },
    ];
  }
  return payload;
}

async function ensureZohoContactForAgency(agency) {
  const existing = await findZohoContactForAgency(agency);
  if (existing?.contact_id) {
    return syncAgencyZohoContact(agency, existing);
  }

  const payload = buildAgencyZohoContactPayload(agency);

  let created = null;
  try {
    created = await createContact_JS(payload);
  } catch (e) {
    throw new Error(
      `Zoho contact creation failed: ${e.response?.data?.message || e.message}`
    );
  }

  if (created?.contact_id) return created;

  const retry = await findZohoContactForAgency(agency);
  if (retry?.contact_id) return retry;

  throw new Error("Zoho contact could not be linked for this agency");
}

async function syncAgencyZohoContact(agency, existingContact = null) {
  const contact = existingContact || (await findZohoContactForAgency(agency));
  if (!contact?.contact_id) {
    return ensureZohoContactForAgency(agency);
  }

  try {
    const payload = buildAgencyZohoContactPayload(agency);
    const updated = await updateContact_JS(contact.contact_id, payload);
    return updated || contact;
  } catch (e) {
    console.warn("Zoho agency contact refresh failed:", e.message);
    return contact;
  }
}

async function fetchAgencyZohoStatus(agency) {
  const zohoContact = await findZohoContactForAgency(agency);
  if (!zohoContact?.contact_id) {
    return {
      linked: false,
      zohoContactId: null,
      invoices: [],
      invoiceCount: 0,
      unpaidCount: 0,
      totalBalanceDue: 0,
    };
  }

  const invoices = await getInvoices_JS({
    customer_id: zohoContact.contact_id,
    per_page: 50,
    page: 1,
  });

  const mapped = (invoices || []).map(mapZohoInvoice);
  const { overdueCount, totalOverdueBalance } = summarizeOverdueZohoInvoices(mapped);

  return {
    linked: true,
    zohoContactId: String(zohoContact.contact_id),
    invoices: mapped,
    invoiceCount: mapped.length,
    unpaidCount: overdueCount,
    totalBalanceDue: totalOverdueBalance,
  };
}

function buildCustomerLineItem(customer, discountPercent = null) {
  const period = computeBillingPeriod({
    paymentFrequency: customer.paymentFrequency || "monthly",
    customPeriodDays: customer.customPeriodDays,
  });
  const grossRate = Number(customer.packagePrice || 0);
  const lineItem = {
    name: buildManagedHouseLineItemName(customer),
    rate: applyAgencyUnitDiscount(grossRate, discountPercent),
    quantity: 1,
    description: buildManagedHouseLineItemDescription(customer, period),
  };
  if (ZOHO_VAT_TAX_ID) {
    lineItem.tax_id = ZOHO_VAT_TAX_ID;
  }
  return lineItem;
}

function lineItemsSubtotal(lineItems) {
  return lineItems.reduce(
    (sum, item) => sum + Number(item.rate || 0) * Number(item.quantity || 1),
    0
  );
}

function resolveInvoiceDiscount(subtotal, discount) {
  if (!discount || discount.value == null || discount.value === "") {
    return { zohoDiscountPercent: null, discountAmount: 0 };
  }

  const value = Number(discount.value);
  if (!Number.isFinite(value) || value <= 0 || subtotal <= 0) {
    return { zohoDiscountPercent: null, discountAmount: 0 };
  }

  if (discount.type === "amount") {
    const discountAmount = Math.min(subtotal, value);
    const zohoDiscountPercent = Math.round((discountAmount / subtotal) * 10000) / 100;
    return { zohoDiscountPercent, discountAmount };
  }

  const zohoDiscountPercent = Math.min(100, value);
  const discountAmount = Math.round((subtotal * zohoDiscountPercent) / 100);
  return { zohoDiscountPercent, discountAmount };
}

/** Prefer invoice-time discount; otherwise use the agency's onboarded percent.
 *  Pass `explicitDiscount: true` when the request included a `discount` field
 *  (including null / off) so operators can clear the standing agency discount
 *  for a single invoice.
 */
function resolveEffectiveAgencyDiscount(
  agency,
  requestDiscount,
  { explicitDiscount = false } = {}
) {
  if (explicitDiscount) {
    if (
      !requestDiscount ||
      requestDiscount.value == null ||
      requestDiscount.value === "" ||
      Number(requestDiscount.value) <= 0
    ) {
      return null;
    }
    return {
      type: requestDiscount.type === "amount" ? "amount" : "percent",
      value: Number(requestDiscount.value),
    };
  }
  const pct = normalizeAgencyDiscountPercent(agency?.discountPercent);
  if (pct) return { type: "percent", value: pct };
  return null;
}

async function listAgencies(req, res, next) {
  try {
    const { search, page, limit, sortBy, sortDir } = req.query;
    const result = await store.listAgencies({ search, page, limit, sortBy, sortDir });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function createAgency(req, res, next) {
  try {
    const { name, email, phone, contactPerson, discountPercent } = req.body || {};
    if (!name || !email || !phone) {
      return res
        .status(400)
        .json({ error: "Name, email, and phone are required" });
    }
    const id = await store.createAgency({
      name,
      email,
      phone,
      contactPerson,
      discountPercent,
    });
    const agency = await store.getAgencyById(id);
    let zoho = { ok: false };
    try {
      const contact = await ensureZohoContactForAgency(agency);
      zoho = {
        ok: true,
        zohoContactId: contact?.contact_id ? String(contact.contact_id) : null,
      };
    } catch (e) {
      zoho = { ok: false, error: e.message || "Zoho contact sync failed" };
    }
    return res.status(201).json({ ok: true, id, agency, zoho });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function getAgency(req, res, next) {
  try {
    const agency = await store.getAgencyById(Number(req.params.id));
    if (!agency) {
      return res.status(404).json({ error: "Agency not found" });
    }
    const customers = await store.listCustomersByAgency(agency.id);
    const billing = computeAgencyBilling(customers, agency.discountPercent);

    let zoho = {
      linked: false,
      zohoContactId: null,
      invoiceCount: 0,
      unpaidCount: 0,
      totalBalanceDue: 0,
    };
    try {
      const status = await fetchAgencyZohoStatus(agency);
      zoho = {
        linked: status.linked,
        zohoContactId: status.zohoContactId,
        invoiceCount: status.invoiceCount,
        unpaidCount: status.unpaidCount,
        totalBalanceDue: status.totalBalanceDue,
      };
    } catch (e) {
      zoho.zohoError = e.message || "Could not load Zoho status";
    }

    return res.json({ agency, customers, billing, zoho });
  } catch (err) {
    return next(err);
  }
}

async function getAgencyInvoices(req, res, next) {
  try {
    const agency = await store.getAgencyById(Number(req.params.id));
    if (!agency) {
      return res.status(404).json({ error: "Agency not found" });
    }
    const status = await fetchAgencyZohoStatus(agency);
    return res.json(status);
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function createAgencyInvoice(req, res, next) {
  try {
    const agencyId = Number(req.params.id);
    const body = req.body || {};
    const { mode = "consolidated", customerId, discount } = body;
    const explicitDiscount = Object.prototype.hasOwnProperty.call(body, "discount");

    const agency = await store.getAgencyById(agencyId);
    if (!agency) {
      return res.status(404).json({ error: "Agency not found" });
    }

    const customers = await store.listCustomersByAgency(agencyId);
    const activeCustomers = customers.filter((c) => c.status === "active");
    const effectiveDiscount = resolveEffectiveAgencyDiscount(agency, discount, {
      explicitDiscount,
    });
    const percentDiscount =
      effectiveDiscount?.type === "percent" ? effectiveDiscount.value : null;

    let lineItems = [];
    let referenceNumber = agency.name;
    let billedCustomers = [];
    let grossSubtotal = 0;

    if (mode === "customer") {
      const customer = customers.find((c) => c.id === Number(customerId));
      if (!customer) {
        return res.status(400).json({ error: "Customer not found for this agency" });
      }
      if (customer.status !== "active") {
        return res.status(400).json({ error: "Only active customers can be invoiced" });
      }
      // B2B line items are always on the agency Zoho contact — never a separate customer invoice.
      const amount = Number(customer.packagePrice || 0);
      if (amount <= 0) {
        return res.status(400).json({ error: "Customer has no billable package price" });
      }
      grossSubtotal = amount;
      lineItems = [buildCustomerLineItem(customer, percentDiscount)];
      referenceNumber = customer.customerNumber;
      billedCustomers = [customer];
    } else if (mode === "consolidated") {
      if (activeCustomers.length === 0) {
        return res.status(400).json({ error: "No active customers to invoice" });
      }
      const billable = activeCustomers.filter((c) => Number(c.packagePrice || 0) > 0);
      if (billable.length === 0) {
        return res.status(400).json({ error: "No billable active customers" });
      }
      grossSubtotal = billable.reduce(
        (sum, c) => sum + Number(c.packagePrice || 0),
        0
      );
      lineItems = billable.map((c) => buildCustomerLineItem(c, percentDiscount));
      billedCustomers = billable;
      referenceNumber = `${agency.name} — ${billable.length} customers`;
    } else {
      return res.status(400).json({ error: "Invalid invoice mode" });
    }

    let zohoDiscountPercent = null;
    let discountAmount = 0;
    let invoiceTotal = lineItemsSubtotal(lineItems);

    if (effectiveDiscount?.type === "amount") {
      // Fixed amount stays as Zoho entity-level discount on full (gross) rates.
      lineItems = billedCustomers.map((c) => buildCustomerLineItem(c, null));
      const subtotal = lineItemsSubtotal(lineItems);
      ({ zohoDiscountPercent, discountAmount } = resolveInvoiceDiscount(
        subtotal,
        effectiveDiscount
      ));
      invoiceTotal = Math.max(0, subtotal - discountAmount);
      grossSubtotal = subtotal;
    } else if (percentDiscount) {
      discountAmount = Math.max(0, grossSubtotal - invoiceTotal);
    }

    const zohoContact = await ensureZohoContactForAgency(agency);
    const invoice = await createInvoice_JS({
      customer_id: zohoContact.contact_id,
      items: lineItems,
      is_inclusive_tax: ZOHO_INVOICE_TAX_INCLUSIVE,
      reference_number: referenceNumber,
      discount: zohoDiscountPercent,
      discount_type: "entity_level",
      is_discount_before_tax: !ZOHO_INVOICE_TAX_INCLUSIVE,
      due_date: computeInvoiceDueDate({ customerType: "B2B" }),
    });

    if (!invoice?.invoice_id) {
      return res.status(502).json({ error: "Zoho invoice creation failed" });
    }

    const invoiceId = String(invoice.invoice_id);
    const invoiceNumber = invoice.invoice_number || null;

    try {
      await logActivity({
        eventType: "zoho_invoice_created",
        title:
          mode === "consolidated"
            ? "Agency consolidated invoice created"
            : "Agency invoice line item created",
        message: `${agency.name}: ${formatCurrency(invoiceTotal)} for ${
          billedCustomers.length
        } customer${billedCustomers.length === 1 ? "" : "s"}${
          discountAmount > 0 ? ` (${formatCurrency(discountAmount)} discount)` : ""
        }${invoiceNumber ? ` · ${invoiceNumber}` : ""}`,
        source: "zoho",
        status: "pending",
        customerRef: billedCustomers[0]?.customerNumber || agency.name,
        amount: invoiceTotal,
        referenceId: invoiceId,
        metadata: {
          agencyId,
          agencyName: agency.name,
          mode,
          customerIds: billedCustomers.map((c) => c.id),
          subtotal: grossSubtotal,
          discountAmount,
          discountType: effectiveDiscount?.type || null,
          discountValue: effectiveDiscount?.value ?? null,
          agencyDiscountPercent: agency.discountPercent ?? null,
        },
      });
    } catch (logErr) {
      console.error("activity log (agency invoice) failed:", logErr.message);
    }

    return res.status(201).json({
      ok: true,
      invoice: {
        id: invoiceId,
        invoiceNumber,
        subtotal: grossSubtotal,
        discountAmount,
        total: invoiceTotal,
        status: invoice.status || "draft",
        zohoContactId: String(zohoContact.contact_id),
      },
      billedCustomers: billedCustomers.map((c) => ({
        id: c.id,
        customerNumber: c.customerNumber,
        fullName: c.fullName,
        packagePrice: c.packagePrice,
        billedRate: applyAgencyUnitDiscount(
          c.packagePrice,
          percentDiscount
        ),
      })),
    });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function updateAgency(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { name, email, phone, contactPerson, discountPercent } = req.body || {};
    await store.updateAgency(id, {
      name,
      email,
      phone,
      contactPerson,
      discountPercent,
    });
    const agency = await store.getAgencyById(id);
    let zoho = { ok: false };
    try {
      const contact = await syncAgencyZohoContact(agency);
      zoho = {
        ok: true,
        zohoContactId: contact?.contact_id ? String(contact.contact_id) : null,
      };
    } catch (e) {
      zoho = { ok: false, error: e.message || "Zoho contact sync failed" };
    }
    return res.json({ ok: true, agency, zoho });
  } catch (err) {
    if (err.message) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

module.exports = {
  listAgencies,
  createAgency,
  getAgency,
  getAgencyInvoices,
  createAgencyInvoice,
  updateAgency,
  ensureZohoContactForAgency,
  syncAgencyZohoContact,
  findZohoContactForAgency,
};
