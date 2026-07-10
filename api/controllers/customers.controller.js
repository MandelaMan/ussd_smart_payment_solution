const { query } = require("../config/db");
const {
  getTISPCustomer,
  postSetClientDetails,
  buildTispCreateClientPayload,
  buildTispUpdateClientDetailsPayload,
  formatTispError,
  accountExistsOnTisp,
} = require("./tisp.controller");
const store = require("../services/customerModuleStore");
const integrationSnapshot = require("../repositories/integrationSnapshot.repository");
const { onboardNewCustomerBilling } = require("../services/customerBillingOnboarding");
const { logActivity } = require("../services/activityLogStore");
const {
  buildCustomerImportTemplateCsv,
  parseCustomerImportCsv,
} = require("../utils/customerImportTemplate");
const {
  calculateUpgradeQuote,
  estimateDueDateFromLastPayment,
} = require("../utils/upgradeQuote");
const { initiateSTKPush } = require("./mpesa.controller");
const {
  getCustomerByCompanyName_JS,
  createInvoice_JS,
  createContact_JS,
} = require("./zoho.controller");
const pendingUpgradeStore = require("../services/pendingUpgradeStore");
const {
  normalizeSubscriptionStatus,
} = require("../utils/subscriptionStatus");
const { listUnifiedTransactions } = require("./admin.controller");
const { mapWithConcurrency } = require("../utils/mapWithConcurrency");
const syncCooldown = require("../utils/syncCooldown");
const {
  getCachedCustomerZoho,
  setCachedCustomerZoho,
  invalidateCustomerZoho,
} = require("../utils/zohoInvoiceCache");
const { sendTableExport } = require("../utils/tableExportResponse");
const {
  pickLatestPaymentDate,
  lastPaymentFromZohoInvoices,
  lastPaymentFromZohoPayments,
} = require("../utils/lastPaymentDate");
const {
  isB2BCustomer,
  getZohoContactLookupKeys,
  resolveAgencyForCustomer,
  filterAgencyInvoicesForCustomer,
  b2bBillingMeta,
} = require("../utils/b2bBilling");

const ZOHO_INVOICE_TAX_INCLUSIVE =
  String(process.env.ZOHO_INVOICE_TAX_INCLUSIVE || "true").toLowerCase() !==
  "false";
const ZOHO_VAT_TAX_ID = process.env.ZOHO_VAT_TAX_ID || null;

async function findZohoContactForCustomer(customer) {
  const lookupKeys = getZohoContactLookupKeys(customer);

  for (const key of lookupKeys) {
    const result = await getCustomerByCompanyName_JS(key);
    if (
      result &&
      typeof result === "object" &&
      !Array.isArray(result) &&
      result.contact_id
    ) {
      return result;
    }
  }
  return null;
}

function formatZohoPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return undefined;
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

async function buildZohoContactPayload(customer) {
  const displayName = [customer.firstName, customer.middleName, customer.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const isB2B = customer.customerType === "B2B";
  const companyName = isB2B
    ? customer.agencyName || displayName || customer.customerNumber
    : displayName || customer.customerNumber;

  const payload = {
    contact_name: companyName,
    company_name: isB2B ? companyName : displayName || companyName,
    contact_type: "customer",
    customer_sub_type: isB2B ? "business" : "individual",
  };

  let phone = formatZohoPhone(customer.phone);
  let email = customer.email ? String(customer.email).trim() : undefined;

  if (isB2B && customer.agencyId) {
    const agency = await store.getAgencyById(customer.agencyId);
    if (agency) {
      phone = formatZohoPhone(agency.phone) || phone;
      email = agency.email ? String(agency.email).trim() : email;
    }
  }

  if (phone) {
    payload.phone = phone;
    payload.mobile = phone;
  }
  if (email) payload.email = email;

  if (displayName && displayName !== companyName) {
    payload.contact_persons = [
      {
        first_name: customer.firstName || displayName,
        last_name: customer.lastName || companyName,
        email,
        phone,
        mobile: phone,
        is_primary_contact: true,
      },
    ];
  }

  return payload;
}

async function ensureZohoContactForCustomer(customer) {
  if (isB2BCustomer(customer)) {
    const { ensureZohoContactForAgency } = require("./agencies.controller");
    const agency = await resolveAgencyForCustomer(customer, store);
    return ensureZohoContactForAgency(agency);
  }

  const existing = await findZohoContactForCustomer(customer);
  if (existing?.contact_id) {
    try {
      const payload = await buildZohoContactPayload(customer);
      const { updateContact_JS } = require("./zoho.controller");
      const updated = await updateContact_JS(existing.contact_id, payload);
      const contact = updated || existing;
      await integrationSnapshot.upsertZohoContact(customer.id, contact);
      return contact;
    } catch (e) {
      console.warn("Zoho contact refresh failed:", e.message);
      try {
        await integrationSnapshot.upsertZohoContact(customer.id, existing);
      } catch {
        /* best-effort */
      }
      return existing;
    }
  }

  const payload = await buildZohoContactPayload(customer);
  let created = null;
  try {
    created = await createContact_JS(payload);
  } catch (e) {
    throw new Error(
      `Zoho contact creation failed: ${e.response?.data?.message || e.message}`
    );
  }

  if (created?.contact_id) {
    try {
      await integrationSnapshot.upsertZohoContact(customer.id, created);
    } catch (e) {
      console.warn("Zoho contact snapshot failed:", e.message);
    }
    return created;
  }

  const retry = await findZohoContactForCustomer(customer);
  if (retry?.contact_id) {
    try {
      await integrationSnapshot.upsertZohoContact(customer.id, retry);
    } catch (e) {
      console.warn("Zoho contact snapshot failed:", e.message);
    }
    return retry;
  }

  throw new Error("Zoho contact could not be linked");
}

async function syncCustomerToZoho(customer) {
  try {
    await ensureZohoContactForCustomer(customer);
    if (customer?.id) invalidateCustomerZoho(customer.id);
    return await fetchCustomerZohoInvoices(customer, { skipCache: true });
  } catch (e) {
    return {
      linked: false,
      zohoContactId: null,
      invoices: [],
      invoiceCount: 0,
      unpaidCount: 0,
      totalBalanceDue: 0,
      zohoError: e.message || "Zoho sync failed",
    };
  }
}

async function syncZohoLastPayment(customer, zohoContactId, rawInvoices) {
  if (!customer?.customerNumber || !zohoContactId) return null;

  const { getCustomerPayments_JS } = require("./zoho.controller");
  const lastFromInvoices = lastPaymentFromZohoInvoices(rawInvoices);
  const payments = await getCustomerPayments_JS({
    customer_id: zohoContactId,
    per_page: 50,
  });
  const lastFromPayments = lastPaymentFromZohoPayments(payments);
  const lastPayment = pickLatestPaymentDate(lastFromInvoices, lastFromPayments);

  if (lastPayment) {
    await store.recordCustomerLastPayment(customer.customerNumber, lastPayment);
  }

  return lastPayment;
}

async function fetchCustomerZohoInvoices(customer, options = {}) {
  const { loadEnv } = require("../config/env");
  const env = loadEnv();
  const customerId = Number(customer?.id);
  const forceRefresh = options.skipCache === true || options.refresh === true;
  const cacheMaxAgeHours = env.CUSTOMER_CACHE_DURATION_SECONDS / 3600;

  if (customerId && !forceRefresh && !isB2BCustomer(customer)) {
    const cached = getCachedCustomerZoho(customerId);
    if (cached) return cached;

    try {
      const stored = await integrationSnapshot.loadCustomerBillingSnapshot(customerId, {
        maxAgeHours: cacheMaxAgeHours,
      });
      if (stored.hasData && stored.zohoContactId && !stored.stale) {
        const mapped = (stored.invoices || []).map((inv) => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          orderNumber: customer.customerNumber,
          date: inv.date,
          dueDate: inv.dueDate,
          status: inv.status,
          total: inv.total,
          balanceDue: inv.balanceDue,
          currency: "KES",
        }));
        const unpaid = mapped.filter((inv) => (inv.balanceDue || 0) > 0);
        const result = {
          linked: true,
          zohoContactId: stored.zohoContactId,
          invoices: mapped,
          invoiceCount: mapped.length,
          unpaidCount: unpaid.length,
          totalBalanceDue: unpaid.reduce((sum, inv) => sum + (inv.balanceDue || 0), 0),
          fromSnapshot: true,
          lastSyncedAt: stored.syncedAt,
          cacheFresh: true,
        };
        setCachedCustomerZoho(customerId, result);
        try {
          await store.reconcileZohoBillingStatus(customerId, {
            linked: true,
            invoiceCount: mapped.length,
          });
        } catch (e) {
          console.warn("Zoho billing status reconcile failed:", e.message);
        }
        return result;
      }
    } catch (e) {
      console.warn("Zoho snapshot read failed:", e.message);
    }
  }

  const { getInvoices_JS } = require("./zoho.controller");

  let agency = null;
  if (isB2BCustomer(customer)) {
    try {
      agency = await resolveAgencyForCustomer(customer, store);
    } catch (e) {
      const empty = {
        linked: false,
        zohoContactId: null,
        invoices: [],
        invoiceCount: 0,
        unpaidCount: 0,
        totalBalanceDue: 0,
        zohoError: e.message,
        ...b2bBillingMeta(customer, null),
      };
      if (customerId) setCachedCustomerZoho(customerId, empty);
      return empty;
    }
  }

  let zohoContact = await findZohoContactForCustomer(
    isB2BCustomer(customer) ? { ...customer, agencyName: agency.name } : customer
  );

  if (!zohoContact?.contact_id) {
    const empty = {
      linked: false,
      zohoContactId: null,
      invoices: [],
      invoiceCount: 0,
      unpaidCount: 0,
      totalBalanceDue: 0,
      ...(isB2BCustomer(customer) ? b2bBillingMeta(customer, agency) : {}),
    };
    if (customerId) setCachedCustomerZoho(customerId, empty);
    return empty;
  }

  const invoices = await getInvoices_JS({
    customer_id: zohoContact.contact_id,
    per_page: 50,
    page: 1,
  });

  if (customerId) {
    try {
      await integrationSnapshot.saveZohoBillingSnapshot(customerId, {
        contact: zohoContact,
        invoices: invoices || [],
        payments: [],
        recurring: [],
      });
    } catch (e) {
      console.warn("Zoho snapshot persist failed:", e.message);
    }
  }

  let lastPaymentDate = null;
  if (!isB2BCustomer(customer)) {
    try {
      lastPaymentDate = await syncZohoLastPayment(
        customer,
        zohoContact.contact_id,
        invoices
      );
    } catch (e) {
      console.error("Zoho last payment sync failed:", e.message);
    }
  }

  const mapped = (invoices || [])
    .map((inv) => ({
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
    }))
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const displayInvoices = isB2BCustomer(customer)
    ? filterAgencyInvoicesForCustomer(mapped, customer.customerNumber)
    : mapped;

  const unpaid = displayInvoices.filter((inv) => (inv.balanceDue || 0) > 0);

  const result = {
    linked: true,
    zohoContactId: zohoContact.contact_id,
    invoices: displayInvoices,
    invoiceCount: displayInvoices.length,
    unpaidCount: unpaid.length,
    totalBalanceDue: unpaid.reduce((sum, inv) => sum + (inv.balanceDue || 0), 0),
    lastPaymentDate,
    ...(isB2BCustomer(customer) ? b2bBillingMeta(customer, agency) : {}),
  };

  if (customerId) setCachedCustomerZoho(customerId, result);

  if (customerId && result.linked && result.invoiceCount > 0) {
    try {
      await store.reconcileZohoBillingStatus(customerId, {
        linked: true,
        invoiceCount: result.invoiceCount,
      });
    } catch (e) {
      console.warn("Zoho billing status reconcile failed:", e.message);
    }
  }

  return result;
}

async function refreshTispStatus(customer) {
  try {
    const tisp = await getTISPCustomer(customer.customerNumber);
    const status =
      tisp?.status ?? tisp?.Status ?? tisp?.subscriptionStatus ?? null;
    if (status) {
      const normalized = normalizeSubscriptionStatus(String(status));
      await store.updateCustomerSubscriptionStatus(customer.id, normalized);
      customer.subscriptionStatus = normalized;
    }
    try {
      await integrationSnapshot.upsertTispSnapshot(customer.id, tisp);
    } catch (e) {
      console.warn("TISP snapshot save failed:", e.message);
    }
    await store.updateCustomerTispSync(customer.id, "synced", null);
  } catch {
    try {
      await store.reconcileTispSyncStatus(customer.id);
    } catch (e) {
      console.warn("TISP sync reconcile failed:", e.message);
    }
  }
  return store.getCustomerById(customer.id);
}

async function refreshTispStatusWithCooldown(customer) {
  syncCooldown.assertSyncAllowed(customer.id);
  try {
    return await refreshTispStatus(customer);
  } finally {
    syncCooldown.recordSync(customer.id);
  }
}

async function resolveTispBuildingName(ctx) {
  let name = String(ctx.building_name || "").trim();
  if (!name && ctx.building_id) {
    const building = await store.getBuildingById(ctx.building_id);
    name = String(building?.name || "").trim();
  }
  if (!name) {
    throw new Error("Building name is required for TISP registration");
  }
  return name;
}

function tispPayloadInput(ctx, buildingName) {
  const isB2B = String(ctx.customer_type || "").toUpperCase() === "B2B";
  return {
    firstName: ctx.first_name,
    middleName: ctx.middle_name,
    lastName: ctx.last_name,
    buildingName,
    customerNumber: ctx.customer_number,
    customerType: ctx.customer_type,
    ipSetup: ctx.ip_setup,
    planName: ctx.plan_name,
    mbps: ctx.product_mbps,
    categoryName: ctx.category_name,
    productName: ctx.product_name,
    apartmentNumber: ctx.apartment_number,
    tispPassword: ctx.tisp_password,
    ipAddress: ctx.ip_address,
    email: ctx.email,
    phone: ctx.phone,
    paymentFrequency: ctx.payment_frequency,
    isVatExempt: Boolean(ctx.is_vat_exempt),
    agencyName: ctx.agency_name || null,
    agencyContactPerson: ctx.agency_contact_person || null,
    agencyPhone: ctx.agency_phone || null,
    agencyEmail: ctx.agency_email || null,
    contactPerson: isB2B
      ? ctx.agency_contact_person || ctx.first_name
      : ctx.first_name,
  };
}

async function createCustomerOnTisp(ctx, meta = {}) {
  const buildingName = await resolveTispBuildingName(ctx);
  const payload = buildTispCreateClientPayload(tispPayloadInput(ctx, buildingName));
  return postSetClientDetails(payload, {
    customerId: ctx.id,
    customerNumber: ctx.customer_number,
    operation: "set_client_create",
    parentLogId: meta.parentLogId ?? null,
  });
}

async function updateCustomerOnTisp(ctx, meta = {}) {
  const buildingName = await resolveTispBuildingName(ctx);
  const payload = buildTispUpdateClientDetailsPayload(tispPayloadInput(ctx, buildingName));
  return postSetClientDetails(payload, {
    customerId: ctx.id,
    customerNumber: ctx.customer_number,
    operation: "set_client_update",
    parentLogId: meta.parentLogId ?? null,
  });
}

async function pushCustomerToTisp(ctx, meta = {}) {
  const skipCooldown = meta.skipCooldown === true;
  if (!skipCooldown) {
    syncCooldown.assertSyncAllowed(ctx.id);
  }

  const currentNumber = String(ctx.customer_number || "").trim().toUpperCase();
  const previousNumber = meta.previousCustomerNumber
    ? String(meta.previousCustomerNumber).trim().toUpperCase()
    : null;

  try {
    const onCurrent = await accountExistsOnTisp(currentNumber);
    if (onCurrent) {
      return await updateCustomerOnTisp(ctx, meta);
    }

    if (previousNumber && previousNumber !== currentNumber) {
      const onPrevious = await accountExistsOnTisp(previousNumber);
      if (onPrevious) {
        return await createCustomerOnTisp(ctx, meta);
      }
    }

    try {
      return await updateCustomerOnTisp(ctx, meta);
    } catch {
      return await createCustomerOnTisp(ctx, meta);
    }
  } finally {
    if (!skipCooldown) {
      syncCooldown.recordSync(ctx.id);
    }
  }
}

async function pushCustomerToZoho(ctx, options = {}) {
  const { pushCustomerBillingToZoho } = require("../services/customerZohoSync");
  return pushCustomerBillingToZoho(ctx, options);
}

async function runZohoSyncForCustomer(customerId, options = {}) {
  const ctx = await store.getCustomerContext(customerId);
  if (!ctx || ctx.status !== "active") {
    return { ok: true, skipped: true };
  }
  try {
    const result = await pushCustomerToZoho(ctx, options);
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e.message || "Zoho sync failed" };
  }
}

async function syncNewCustomerToTisp(customerId, customerNumber, meta = {}) {
  syncCooldown.assertSyncAllowed(customerId);
  try {
    const ctx = await store.getCustomerContext(customerId);
    await createCustomerOnTisp(ctx, meta);
    await store.updateCustomerTispSync(customerId, "synced", null);
    try {
      await refreshTispStatus({ id: customerId, customerNumber });
    } catch {
      // best-effort
    }
    return null;
  } catch (e) {
    const tispError = formatTispError(e);
    await store.updateCustomerTispSync(customerId, "failed", tispError);
    return tispError;
  } finally {
    syncCooldown.recordSync(customerId);
  }
}

async function listCustomers(req, res, next) {
  try {
    const {
      status,
      subscriptionStatus,
      buildingId,
      search,
      page,
      limit,
      refresh,
      categoryId,
      customerType,
      sortBy,
      sortDir,
    } = req.query;
    const result = await store.listCustomers({
      accountStatus: status,
      subscriptionStatus: subscriptionStatus || undefined,
      buildingId: buildingId ? Number(buildingId) : undefined,
      search,
      page,
      limit,
      categoryId: categoryId ? Number(categoryId) : undefined,
      customerType,
      sortBy,
      sortDir,
    });

    if (refresh === "true") {
      const active = result.data.filter((c) => c.status === "active");
      const toRefresh = active.filter((c) => syncCooldown.getRemainingMs(c.id) <= 0);
      await mapWithConcurrency(toRefresh, 5, (c) =>
        refreshTispStatusWithCooldown(c)
      );
    }

    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

function csvCell(value) {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

const CUSTOMER_EXPORT_COLUMNS = [
  { key: "customerNumber", label: "Customer #" },
  { key: "fullName", label: "Name" },
  { key: "customerType", label: "Type" },
  { key: "buildingName", label: "Building" },
  { key: "apartmentNumber", label: "Apartment" },
  { key: "productName", label: "Package" },
  { key: "paymentFrequency", label: "Billing" },
  { key: "subscriptionStatus", label: "Status" },
  { key: "packagePrice", label: "Price" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "status", label: "Account" },
  { key: "createdAt", label: "Created" },
];

const REQUIRED_CUSTOMER_EXPORT_KEYS = new Set([
  "customerNumber",
  "fullName",
  "customerType",
  "apartmentNumber",
  "subscriptionStatus",
]);

function resolveCustomerExportColumns(columnsParam) {
  if (!columnsParam || String(columnsParam).toLowerCase() === "all") {
    return CUSTOMER_EXPORT_COLUMNS;
  }
  const requested = new Set(
    String(columnsParam)
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean)
  );
  for (const key of REQUIRED_CUSTOMER_EXPORT_KEYS) requested.add(key);
  return CUSTOMER_EXPORT_COLUMNS.filter((col) => requested.has(col.key));
}

function mapCustomerExportRow(row) {
  return {
    customerNumber: row.customerNumber,
    fullName: row.fullName,
    customerType: row.customerType,
    buildingName: row.buildingName,
    apartmentNumber: row.apartmentNumber,
    productName: row.productName,
    paymentFrequency: row.paymentFrequency,
    subscriptionStatus: row.subscriptionStatus,
    packagePrice: row.packagePrice,
    phone: row.phone,
    email: row.email || "",
    status: row.status,
    createdAt: row.createdAt,
  };
}

function toCustomersCsv(rows, columns = CUSTOMER_EXPORT_COLUMNS) {
  const headers = columns.map((col) => col.label);
  const lines = [headers.join(",")];
  for (const row of rows) {
    const mapped = mapCustomerExportRow(row);
    lines.push(columns.map((col) => csvCell(mapped[col.key])).join(","));
  }
  return lines.join("\n");
}

async function buildCustomersExportReport(rows, columns = CUSTOMER_EXPORT_COLUMNS) {
  return {
    title: "Customers",
    headers: columns,
    rows: rows.map(mapCustomerExportRow),
  };
}

async function exportCustomers(req, res, next) {
  try {
    const {
      status,
      subscriptionStatus,
      buildingId,
      search,
      page,
      limit,
      categoryId,
      customerType,
      sortBy,
      sortDir,
      format,
      scope,
      columns,
    } = req.query;

    const exportScope = String(scope || "view").toLowerCase();
    const pageNum =
      exportScope === "all"
        ? 1
        : Math.max(1, parseInt(String(page || "1"), 10) || 1);
    const limitNum =
      exportScope === "all"
        ? 10000
        : Math.min(100, Math.max(1, parseInt(String(limit || "20"), 10) || 20));

    const result = await store.listCustomers({
      accountStatus: status,
      subscriptionStatus: subscriptionStatus || undefined,
      buildingId: buildingId ? Number(buildingId) : undefined,
      search,
      page: pageNum,
      limit: limitNum,
      categoryId: categoryId ? Number(categoryId) : undefined,
      customerType,
      sortBy,
      sortDir,
      forExport: exportScope === "all",
    });

    const safeFormat = String(format || "csv").toLowerCase();
    const scopeSuffix =
      exportScope === "all" ? "all-records" : "current-view";
    const exportColumns = resolveCustomerExportColumns(columns);
    const report = await buildCustomersExportReport(result.data, exportColumns);
    return sendTableExport(
      res,
      report,
      safeFormat,
      `customers-${scopeSuffix}`
    );
  } catch (err) {
    return next(err);
  }
}

async function getCustomer(req, res, next) {
  try {
    const id = Number(req.params.id);
    let customer = await store.getCustomerById(id);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }
    if (req.query.refresh === "true" && customer.status === "active") {
      await refreshTispStatusWithCooldown(customer);
      customer = await store.getCustomerById(id);
    }

    const [events, pendingUpgrade] = await Promise.all([
      store.getCustomerEvents(id),
      pendingUpgradeStore.getActivePendingUpgrade(id),
    ]);

    return res.json({ customer, events, pendingUpgrade });
  } catch (err) {
    return next(err);
  }
}

async function createCustomer(req, res, next) {
  try {
    const body = req.body || {};
    if (!body.firstName || !body.lastName) {
      return res.status(400).json({ error: "First name and last name are required" });
    }
    if (!body.phone || !body.email || !body.customerType || !body.apartmentNumber) {
      return res
        .status(400)
        .json({ error: "Phone, email, customer type, and apartment number are required" });
    }
    if (!body.buildingId || !body.productId || !body.paymentFrequency) {
      return res.status(400).json({
        error: "Building, package, and payment frequency are required",
      });
    }
    if (!["C2B", "B2B"].includes(body.customerType)) {
      return res.status(400).json({ error: "Customer type must be C2B or B2B" });
    }
    if (
      !["monthly", "quarterly", "yearly", "custom"].includes(
        body.paymentFrequency
      )
    ) {
      return res.status(400).json({ error: "Invalid payment frequency" });
    }
    if (
      body.paymentFrequency === "custom" &&
      !body.customPeriodDays &&
      !body.customPeriodMonths
    ) {
      return res
        .status(400)
        .json({ error: "Custom period days is required for custom billing" });
    }

    const created = await store.createCustomer(body);

    const tispError = await syncNewCustomerToTisp(
      created.customerId,
      created.customerNumber
    );

    let zoho = { ok: false, error: null, invoice: null };
    try {
      zoho = await onboardNewCustomerBilling(created.customerId);
    } catch (e) {
      zoho = { ok: false, error: e.message || "Zoho billing setup failed" };
    }

    try {
      await logActivity({
        eventType: tispError
          ? "customer_created_tisp_failed"
          : zoho.ok
            ? "customer_created"
            : "customer_created_zoho_failed",
        title: tispError
          ? "Customer created (TISP sync failed)"
          : zoho.ok
            ? "New customer registered"
            : "Customer created (Zoho billing failed)",
        message: tispError
          ? `${created.customerNumber}: ${tispError}`
          : zoho.error
            ? `${created.customerNumber}: ${zoho.error}`
            : `${created.customerName} (${created.customerNumber})`,
        source: tispError ? "tisp" : zoho.ok ? "admin" : "zoho",
        status: tispError || !zoho.ok ? "failed" : "success",
        customerRef: created.customerNumber,
      });
    } catch (logErr) {
      console.error("activity log (customer create) failed:", logErr.message);
    }

    const customer = await store.getCustomerById(created.customerId);
    return res.status(201).json({
      ok: true,
      customer,
      tisp: tispError ? { ok: false, error: tispError } : { ok: true },
      zoho: zoho.ok
        ? {
            ok: true,
            zohoContactId: zoho.zohoContactId,
            invoice: zoho.invoice,
            recurring: zoho.recurring,
            trial: zoho.trial || null,
          }
        : { ok: false, error: zoho.error },
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      const msg = String(err.message || "");
      if (msg.includes("uk_ip_address")) {
        return res.status(409).json({ error: "IP address is already assigned" });
      }
      if (msg.includes("uk_customer_number")) {
        return res.status(409).json({ error: "Customer number already exists for this apartment" });
      }
      return res.status(409).json({ error: "Duplicate customer record" });
    }
    if (err.message && !err.statusCode) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

function resolveBillingOptions(current, overrides = {}) {
  const paymentFrequency =
    overrides.paymentFrequency || current.payment_frequency;
  let customPeriodDays =
    overrides.customPeriodDays !== undefined
      ? overrides.customPeriodDays
      : overrides.customPeriodMonths !== undefined
        ? Number(overrides.customPeriodMonths) * 30
        : current.custom_period_days;

  if (paymentFrequency === "custom") {
    customPeriodDays = Number(customPeriodDays);
    if (!customPeriodDays || customPeriodDays < 1) {
      throw new Error("Custom period must be at least 1 day");
    }
  } else {
    customPeriodDays = null;
  }

  return { paymentFrequency, customPeriodDays };
}

async function buildUpgradeQuote(customerId, productId, billingOverrides = {}) {
  const current = await store.getCustomerContext(customerId);
  if (!current) {
    return { error: "Customer not found", status: 404 };
  }

  const newProduct = await store.getProductById(productId);
  if (!newProduct) {
    return { error: "Product not found", status: 404 };
  }
  if (newProduct.mbps <= current.product_mbps) {
    return {
      error: "Select a higher Mbps package to upgrade",
      status: 400,
    };
  }

  const customerRow = await store.getCustomerById(customerId);

  const { paymentFrequency, customPeriodDays } = resolveBillingOptions(
    current,
    billingOverrides
  );

  let dueDate = null;
  let subscriptionStatus = customerRow.subscriptionStatus;

  if (customerRow.lastPaymentDate) {
    dueDate = estimateDueDateFromLastPayment(
      customerRow.lastPaymentDate,
      paymentFrequency,
      customPeriodDays
    );
  }

  if (!dueDate) {
    const quoteTispTimeoutMs = Number(process.env.TISP_QUOTE_TIMEOUT_MS || 5_000);
    try {
      const tisp = await Promise.race([
        getTISPCustomer(customerRow.customerNumber),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("TISP quote lookup timed out")),
            quoteTispTimeoutMs
          )
        ),
      ]);
      dueDate = tisp?.dueDate ?? tisp?.duedate ?? null;
      const tispStatus = tisp?.status ?? tisp?.Status ?? null;
      if (tispStatus) {
        subscriptionStatus = normalizeSubscriptionStatus(String(tispStatus));
        await store.updateCustomerSubscriptionStatus(customerId, subscriptionStatus);
        customerRow.subscriptionStatus = subscriptionStatus;
      }
    } catch {
      /* use stored billing data when TISP is slow or unreachable */
    }
  }

  const currentProduct = await store.getProductById(current.product_id);
  const currentPrice = store.resolvePackagePrice(
    currentProduct,
    paymentFrequency,
    customPeriodDays
  );
  const newPrice = store.resolvePackagePrice(
    newProduct,
    paymentFrequency,
    customPeriodDays
  );

  const quote = calculateUpgradeQuote({
    currentPrice,
    newPrice,
    paymentFrequency,
    customPeriodDays,
    subscriptionStatus,
    dueDate,
    customerType: current.customer_type,
  });

  return {
    quote: {
      ...quote,
      customerNumber: customerRow.customerNumber,
      currentMbps: current.product_mbps,
      newMbps: newProduct.mbps,
      newProductName: newProduct.name,
      paymentFrequency,
      customPeriodDays,
    },
    current,
    newProduct,
    customerRow,
  };
}

async function getUpgradeQuote(req, res, next) {
  try {
    const productId = Number(req.query.productId);
    if (!productId) {
      return res.status(400).json({ error: "productId query is required" });
    }

    const billingOverrides = {};
    if (req.query.paymentFrequency) {
      billingOverrides.paymentFrequency = String(req.query.paymentFrequency);
    }
    if (req.query.customPeriodDays != null && req.query.customPeriodDays !== "") {
      billingOverrides.customPeriodDays = Number(req.query.customPeriodDays);
    } else if (
      req.query.customPeriodMonths != null &&
      req.query.customPeriodMonths !== ""
    ) {
      billingOverrides.customPeriodDays = Number(req.query.customPeriodMonths) * 30;
    }

    const result = await buildUpgradeQuote(
      Number(req.params.id),
      productId,
      billingOverrides
    );
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    return res.json({ quote: result.quote });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function createUpgradeInvoice(customer, quote) {
  let zohoContact;
  let referenceNumber = customer.customerNumber;
  const ctx = await store.getCustomerContext(customer.id);

  if (isB2BCustomer(customer)) {
    const agency = await resolveAgencyForCustomer(customer, store);
    zohoContact = await findZohoContactForCustomer({
      ...customer,
      agencyName: agency.name,
    });
    if (!zohoContact?.contact_id) {
      const { ensureZohoContactForAgency } = require("./agencies.controller");
      zohoContact = await ensureZohoContactForAgency(agency);
    }
    referenceNumber = `${agency.name} — ${customer.customerNumber} upgrade`;
  } else {
    zohoContact = await findZohoContactForCustomer(customer);
  }

  if (!zohoContact?.contact_id) {
    throw new Error("Customer is not linked in Zoho — cannot create invoice");
  }

  const description = isB2BCustomer(customer)
    ? `Package upgrade (B2B via ${customer.agencyName}): ${quote.currentMbps} → ${quote.newMbps} Mbps (${customer.customerNumber})`
    : `Package upgrade top-up: ${quote.currentMbps} → ${quote.newMbps} Mbps (${customer.customerNumber})`;
  const lineItem = {
    name: `Package upgrade — ${quote.newMbps} Mbps`,
    rate: quote.topUpAmount,
    quantity: 1,
    description,
  };
  if (ZOHO_VAT_TAX_ID) {
    lineItem.tax_id = ZOHO_VAT_TAX_ID;
  }

  const { buildZohoInvoiceNumber } = require("../utils/zohoInvoiceNumber");
  const buildingCode =
    ctx?.customer_type === "B2B" ? ctx?.b2b_code : ctx?.c2b_code;

  const invoice = await createInvoice_JS({
    customer_id: zohoContact.contact_id,
    items: [lineItem],
    is_inclusive_tax: ZOHO_INVOICE_TAX_INCLUSIVE,
    reference_number: referenceNumber,
    invoice_number: await buildZohoInvoiceNumber({
      customerId: customer.id,
      customerNumber: customer.customerNumber,
      buildingCode,
    }),
  });

  return {
    invoiceId: invoice?.invoice_id ? String(invoice.invoice_id) : null,
    invoiceNumber: invoice?.invoice_number || null,
    total: quote.topUpAmount,
  };
}

async function upgradePackage(req, res, next) {
  try {
    const { productId, paymentMethod, paymentFrequency, customPeriodDays } =
      req.body || {};
    if (!productId) {
      return res.status(400).json({ error: "productId is required" });
    }

    const customerId = Number(req.params.id);
    const existingPending =
      await pendingUpgradeStore.getActivePendingUpgrade(customerId);
    if (existingPending) {
      return res.status(409).json({
        error:
          "Customer already has a pending upgrade awaiting payment.",
        pendingUpgrade: existingPending,
      });
    }

    if (paymentFrequency) {
      await store.updateCustomerBillingCycle(
        customerId,
        paymentFrequency,
        customPeriodDays
      );
    }

    const built = await buildUpgradeQuote(customerId, Number(productId));
    if (built.error) {
      return res.status(built.status).json({ error: built.error });
    }

    const { quote, current, newProduct, customerRow } = built;
    let payment = null;
    let pendingUpgrade = null;

    if (quote.paymentRequired) {
      const method = paymentMethod || quote.recommendedPaymentMethod;
      if (method !== "invoice" && method !== "stk") {
        return res.status(400).json({
          error:
            "paymentMethod must be 'invoice' or 'stk' when a top-up is required",
          quote,
        });
      }

      if (method === "invoice") {
        let invoiceDetails;
        try {
          invoiceDetails = await createUpgradeInvoice(customerRow, quote);
        } catch (e) {
          return res.status(400).json({ error: e.message, quote });
        }

        payment = { method: "invoice", ...invoiceDetails };
        pendingUpgrade = await pendingUpgradeStore.createPendingUpgrade({
          customerId,
          targetProductId: Number(productId),
          paymentMethod: "invoice",
          topUpAmount: quote.topUpAmount,
          quote,
          zohoInvoiceId: payment.invoiceId,
          zohoInvoiceNumber: payment.invoiceNumber,
        });

        try {
          await logActivity({
            eventType: "zoho_invoice_created",
            title: "Upgrade invoice created",
            message: `${customerRow.customerNumber}: ${formatCurrency(quote.topUpAmount)} for ${quote.currentMbps} → ${quote.newMbps} Mbps — awaiting payment`,
            source: "zoho",
            status: "pending",
            customerRef: customerRow.customerNumber,
            referenceId: payment.invoiceId,
          });
        } catch (logErr) {
          console.error("activity log (upgrade invoice) failed:", logErr.message);
        }
      } else if (method === "stk") {
        if (!customerRow.phone) {
          return res
            .status(400)
            .json({ error: "Customer phone number is required for STK push", quote });
        }

        pendingUpgrade = await pendingUpgradeStore.createPendingUpgrade({
          customerId,
          targetProductId: Number(productId),
          paymentMethod: "stk",
          topUpAmount: quote.topUpAmount,
          quote,
        });

        const stk = await initiateSTKPush(
          customerRow.customerNumber,
          customerRow.phone,
          quote.topUpAmount,
          { liveAmount: true }
        );
        if (stk?.error) {
          await pendingUpgradeStore.cancelPendingUpgrade(pendingUpgrade.id);
          return res
            .status(502)
            .json({ error: stk.error || "Failed to initiate STK push", quote });
        }

        await pendingUpgradeStore.attachCheckoutToPendingUpgrade(
          pendingUpgrade.id,
          stk.CheckoutRequestID
        );
        pendingUpgrade = await pendingUpgradeStore.getPendingUpgradeById(
          pendingUpgrade.id
        );

        payment = {
          method: "stk",
          checkoutRequestId: stk.CheckoutRequestID || null,
          merchantRequestId: stk.MerchantRequestID || null,
          amount: quote.topUpAmount,
          phone: customerRow.phone,
        };
      }

      try {
        await logActivity({
          eventType: "upgrade_payment_pending",
          title: "Upgrade awaiting payment",
          message: `${customerRow.customerNumber}: ${quote.currentMbps} → ${quote.newMbps} Mbps · ${formatCurrency(quote.topUpAmount)} via ${payment?.method}`,
          source: payment?.method === "invoice" ? "zoho" : "mpesa",
          status: "pending",
          customerRef: customerRow.customerNumber,
          amount: quote.topUpAmount,
          referenceId:
            payment?.invoiceId || payment?.checkoutRequestId || null,
        });
      } catch (logErr) {
        console.error("activity log (upgrade pending) failed:", logErr.message);
      }

      const customer = await store.getCustomerById(customerId);
      return res.json({
        ok: true,
        pending: true,
        customer,
        quote,
        payment,
        pendingUpgrade,
      });
    }

    const { newProduct: product } = await store.changeCustomerProduct(
      customerId,
      Number(productId),
      "upgrade"
    );

    const ctx = await store.getCustomerContext(customerId);
    let tispError = null;
    try {
      await pushCustomerToTisp(ctx, { skipCooldown: true });
    } catch (e) {
      tispError = e.message;
    }
    const zoho = await runZohoSyncForCustomer(customerId);

    const customer = await store.getCustomerById(customerId);

    try {
      await logActivity({
        eventType: "customer_upgraded",
        title: "Customer package upgraded",
        message: `${customer?.customerNumber}: ${current.product_mbps} → ${newProduct.mbps} Mbps`,
        source: "tisp",
        status: tispError ? "failed" : "success",
        customerRef: customer?.customerNumber,
      });
    } catch (logErr) {
      console.error("activity log (upgrade) failed:", logErr.message);
    }

    return res.json({
      ok: true,
      pending: false,
      customer,
      product,
      quote,
      payment,
      tisp: tispError ? { ok: false, error: tispError } : { ok: true },
      zoho,
    });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

function formatCurrency(amount) {
  return `KES ${Number(amount || 0).toLocaleString("en-KE")}`;
}

async function downgradePackage(req, res, next) {
  try {
    const { productId, paymentFrequency, customPeriodDays } = req.body || {};
    if (!productId) {
      return res.status(400).json({ error: "productId is required" });
    }
    const customerId = Number(req.params.id);
    const current = await store.getCustomerContext(customerId);
    if (!current) return res.status(404).json({ error: "Customer not found" });

    const pendingUpgrade = await pendingUpgradeStore.getActivePendingUpgrade(customerId);
    if (pendingUpgrade) {
      await pendingUpgradeStore.cancelPendingUpgrade(pendingUpgrade.id);
    }

    const newProduct = await store.getProductById(productId);
    if (newProduct.mbps >= current.product_mbps) {
      return res
        .status(400)
        .json({ error: "Select a lower Mbps package to downgrade" });
    }

    if (paymentFrequency) {
      await store.updateCustomerBillingCycle(
        customerId,
        paymentFrequency,
        customPeriodDays
      );
    }

    const { newProduct: product } = await store.changeCustomerProduct(
      customerId,
      Number(productId),
      "downgrade"
    );

    const ctx = await store.getCustomerContext(customerId);
    let tispError = null;
    try {
      await pushCustomerToTisp(ctx, { skipCooldown: true });
    } catch (e) {
      tispError = e.message;
    }
    const zoho = await runZohoSyncForCustomer(customerId);

    const customer = await store.getCustomerById(Number(req.params.id));

    try {
      await logActivity({
        eventType: "customer_downgraded",
        title: "Customer package downgraded",
        message: `${customer?.customerNumber}: ${current.product_mbps} → ${newProduct.mbps} Mbps`,
        source: "tisp",
        status: tispError ? "failed" : "success",
        customerRef: customer?.customerNumber,
      });
    } catch (logErr) {
      console.error("activity log (downgrade) failed:", logErr.message);
    }

    return res.json({
      ok: true,
      customer,
      product,
      tisp: tispError ? { ok: false, error: tispError } : { ok: true },
      zoho,
    });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function cancelPendingUpgrade(req, res, next) {
  try {
    const customerId = Number(req.params.id);
    const customer = await store.getCustomerById(customerId);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const pending = await pendingUpgradeStore.getActivePendingUpgrade(customerId);
    if (!pending) {
      return res.status(404).json({ error: "No pending upgrade to cancel" });
    }

    const cancelled = await pendingUpgradeStore.cancelPendingUpgrade(pending.id);
    const updatedCustomer = await store.getCustomerById(customerId);

    try {
      await logActivity({
        eventType: "upgrade_payment_cancelled",
        title: "Pending upgrade cancelled",
        message: `${customer.customerNumber}: ${pending.quote?.currentMbps ?? "?"} → ${pending.targetProductMbps} Mbps`,
        source: "admin",
        status: "success",
        customerRef: customer.customerNumber,
      });
    } catch (logErr) {
      console.error("activity log (upgrade cancel) failed:", logErr.message);
    }

    return res.json({
      ok: true,
      customer: updatedCustomer,
      pendingUpgrade: cancelled,
    });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function changePaymentFrequency(req, res, next) {
  try {
    const { paymentFrequency, customPeriodDays } = req.body || {};
    if (!paymentFrequency) {
      return res.status(400).json({ error: "paymentFrequency is required" });
    }

    const customerId = Number(req.params.id);
    const pendingUpgrade =
      await pendingUpgradeStore.getActivePendingUpgrade(customerId);
    if (pendingUpgrade) {
      return res.status(409).json({
        error:
          "Customer has a pending upgrade awaiting payment. Cancel it before changing billing frequency.",
        pendingUpgrade,
      });
    }

    const result = await store.changeCustomerPaymentFrequency(
      customerId,
      paymentFrequency,
      customPeriodDays
    );

    const ctx = await store.getCustomerContext(customerId);
    let tispError = null;
    try {
      await pushCustomerToTisp(ctx, { skipCooldown: true });
    } catch (e) {
      tispError = e.message;
    }
    const zoho = await runZohoSyncForCustomer(customerId);

    const customer = await store.getCustomerById(customerId);

    try {
      await logActivity({
        eventType: "customer_upgraded",
        title: "Payment frequency changed",
        message: `${customer?.customerNumber}: ${result.previousFrequency} → ${paymentFrequency}`,
        source: "tisp",
        status: tispError ? "failed" : "success",
        customerRef: customer?.customerNumber,
      });
    } catch (logErr) {
      console.error("activity log (payment frequency) failed:", logErr.message);
    }

    return res.json({
      ok: true,
      customer,
      product: result.newProduct,
      packagePrice: result.packagePrice,
      tisp: tispError ? { ok: false, error: tispError } : { ok: true },
      zoho,
    });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function switchApartment(req, res, next) {
  try {
    const { apartmentNumber } = req.body || {};
    if (!apartmentNumber) {
      return res.status(400).json({ error: "apartmentNumber is required" });
    }

    const result = await store.switchCustomerApartment(
      Number(req.params.id),
      apartmentNumber
    );

    let tispError = null;
    try {
      await pushCustomerToTisp(result.customer, {
        previousCustomerNumber: result.previousCustomerNumber,
      });
      await store.updateCustomerTispSync(Number(req.params.id), "synced", null);
    } catch (e) {
      tispError = e.message;
    }
    const zoho = await runZohoSyncForCustomer(Number(req.params.id));

    const customer = await store.getCustomerById(Number(req.params.id));

    try {
      await logActivity({
        eventType: "customer_apartment_switched",
        title: "Customer apartment switched",
        message: `${customer?.customerNumber}: ${result.oldApartment} → ${result.newApartment}`,
        source: "tisp",
        status: tispError ? "failed" : "success",
        customerRef: customer?.customerNumber,
      });
    } catch (logErr) {
      console.error("activity log (switch apartment) failed:", logErr.message);
    }

    return res.json({
      ok: true,
      customer,
      tisp: tispError ? { ok: false, error: tispError } : { ok: true },
      zoho,
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Target apartment customer number already exists" });
    }
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function cancelSubscription(req, res, next) {
  try {
    const { notes } = req.body || {};
    await store.cancelCustomer(Number(req.params.id), notes);
    const customer = await store.getCustomerById(Number(req.params.id));

    await logActivity({
      eventType: "customer_cancelled",
      title: "Customer subscription cancelled",
      message: customer?.customerNumber || "",
      source: "tisp",
      status: "success",
      customerRef: customer?.customerNumber,
    });

    return res.json({ ok: true, customer });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function deleteCustomerPermanently(req, res, next) {
  try {
    const id = Number(req.params.id);
    const customer = await store.getCustomerById(id);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const [onTisp, zohoContact] = await Promise.all([
      accountExistsOnTisp(customer.customerNumber),
      findZohoContactForCustomer(customer),
    ]);

    if (onTisp && zohoContact?.contact_id) {
      return res.status(400).json({
        error:
          "Cannot delete this customer because accounts exist on both TISP and Zoho.",
      });
    }
    if (onTisp) {
      return res.status(400).json({
        error: "Cannot delete this customer because an account exists on TISP.",
      });
    }
    if (zohoContact?.contact_id) {
      return res.status(400).json({
        error: "Cannot delete this customer because a Zoho contact exists.",
      });
    }

    const deleted = await store.deleteCustomerCompletely(id);
    invalidateCustomerZoho(id);

    return res.json({ ok: true, customerNumber: deleted.customerNumber });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function bulkCancelSubscriptions(req, res, next) {
  try {
    const { ids, notes } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids array is required" });
    }

    const uniqueIds = [
      ...new Set(
        ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
      ),
    ];
    if (!uniqueIds.length) {
      return res.status(400).json({ error: "No valid customer ids provided" });
    }

    const results = [];
    for (const id of uniqueIds) {
      try {
        await store.cancelCustomer(id, notes);
        const customer = await store.getCustomerById(id);
        results.push({
          id,
          ok: true,
          customerNumber: customer?.customerNumber || null,
        });
        try {
          await logActivity({
            eventType: "customer_cancelled",
            title: "Customer subscription cancelled",
            message: customer?.customerNumber || "",
            source: "tisp",
            status: "success",
            customerRef: customer?.customerNumber,
          });
        } catch (logErr) {
          console.error("activity log (bulk cancel) failed:", logErr.message);
        }
      } catch (e) {
        results.push({
          id,
          ok: false,
          error: e.message,
        });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    return res.json({
      ok: true,
      total: results.length,
      succeeded,
      failed: results.length - succeeded,
      results,
    });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function apartmentHistory(req, res, next) {
  try {
    const { buildingId, apartmentNumber } = req.params;
    const history = await store.getApartmentHistory(
      Number(buildingId),
      apartmentNumber
    );
    return res.json({ history });
  } catch (err) {
    return next(err);
  }
}

function downloadImportTemplate(_req, res) {
  const csv = buildCustomerImportTemplateCsv();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="customer-import-template.csv"'
  );
  return res.send(csv);
}

const IMPORT_PROGRESS = {
  validating: "Validating row data…",
  resolving: "Looking up building and package…",
  checking_duplicates: "Checking for duplicate customer number and IP…",
  checking_apartment: "Checking apartment availability…",
  creating: "Creating customer record…",
  tisp_sync: "Registering customer on TISP…",
  tisp_status: "Fetching active status from TISP…",
  zoho_sync: "Linking customer in Zoho Books…",
  zoho_invoices: "Fetching invoice information from Zoho…",
  done: "Customer imported successfully",
};

function emitImportProgress(emit, payload) {
  if (typeof emit !== "function") return;
  emit({
    ...payload,
    message:
      payload.message ||
      IMPORT_PROGRESS[payload.step] ||
      payload.step ||
      "",
  });
}

async function importCustomerRowWithProgress(row, emit, batchSeen) {
  emitImportProgress(emit, {
    type: "progress",
    line: row.line,
    step: "validating",
  });

  emitImportProgress(emit, {
    type: "progress",
    line: row.line,
    step: "resolving",
  });

  emitImportProgress(emit, {
    type: "progress",
    line: row.line,
    step: "checking_duplicates",
  });

  emitImportProgress(emit, {
    type: "progress",
    line: row.line,
    step: "checking_apartment",
  });

  emitImportProgress(emit, {
    type: "progress",
    line: row.line,
    step: "creating",
  });

  let created;
  try {
    created = await store.importCustomerFromRow(row, batchSeen);
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      const msg = String(e.message || "");
      if (msg.includes("uk_customer_number")) {
        throw new Error("Customer number already exists for this apartment");
      }
      if (msg.includes("uk_ip_address")) {
        throw new Error("IP address is already assigned");
      }
      throw new Error("Duplicate customer record");
    }
    throw e;
  }

  emitImportProgress(emit, {
    type: "progress",
    line: row.line,
    step: "tisp_sync",
    customerNumber: created.customerNumber,
  });

  const tispError = await syncNewCustomerToTisp(
    created.customerId,
    created.customerNumber
  );

  emitImportProgress(emit, {
    type: "progress",
    line: row.line,
    step: "tisp_status",
    customerNumber: created.customerNumber,
  });

  try {
    const customerForTisp = await store.getCustomerById(created.customerId);
    if (customerForTisp?.status === "active") {
      await refreshTispStatus(customerForTisp);
    }
  } catch {
    // best-effort
  }

  emitImportProgress(emit, {
    type: "progress",
    line: row.line,
    step: "zoho_sync",
    customerNumber: created.customerNumber,
  });

  let zoho = {
    linked: false,
    zohoContactId: null,
    invoiceCount: 0,
    unpaidCount: 0,
    totalBalanceDue: 0,
    zohoError: null,
  };
  try {
    const billing = await onboardNewCustomerBilling(created.customerId);
    zoho = {
      linked: billing.ok,
      zohoContactId: billing.zohoContactId,
      invoiceCount: billing.invoice?.invoiceId ? 1 : 0,
      unpaidCount: billing.invoice?.invoiceId ? 1 : 0,
      totalBalanceDue: billing.invoice?.total ?? 0,
      zohoError: billing.error ?? null,
      signupInvoice: billing.invoice ?? null,
    };
  } catch (e) {
    zoho.zohoError = e.message || "Zoho billing setup failed";
  }

  emitImportProgress(emit, {
    type: "progress",
    line: row.line,
    step: "zoho_invoices",
    customerNumber: created.customerNumber,
  });

  const customer = await store.getCustomerById(created.customerId);

  try {
    await logActivity({
      eventType: tispError
        ? "customer_imported_tisp_failed"
        : zoho.zohoError
          ? "customer_imported"
          : "customer_imported",
      title: tispError
        ? "Customer imported (TISP sync failed)"
        : zoho.zohoError
          ? "Customer imported (Zoho sync failed)"
          : "Customer imported",
      message: tispError
        ? `${created.customerNumber}: ${tispError}`
        : zoho.zohoError
          ? `${created.customerNumber}: ${zoho.zohoError}`
          : `${customer?.fullName || created.customerNumber} (${created.customerNumber})`,
      source: "admin",
      status: tispError || zoho.zohoError ? "failed" : "success",
      customerRef: created.customerNumber,
    });
  } catch (logErr) {
    console.error("activity log (customer import) failed:", logErr.message);
  }

  emitImportProgress(emit, {
    type: "progress",
    line: row.line,
    step: "done",
    customerNumber: created.customerNumber,
  });

  return {
    line: row.line,
    ok: true,
    customerNumber: created.customerNumber,
    tispOk: !tispError,
    tispError: tispError || null,
    zohoOk: zoho.linked && !zoho.zohoError,
    zohoError: zoho.zohoError || null,
    zohoLinked: zoho.linked,
    zohoInvoiceCount: zoho.invoiceCount,
    zohoUnpaidCount: zoho.unpaidCount,
    customer,
  };
}

async function importCustomers(req, res, next) {
  try {
    const csvText = typeof req.body === "string" ? req.body : "";
    if (!csvText.trim()) {
      return res.status(400).json({ error: "CSV body is required" });
    }

    const rows = parseCustomerImportCsv(csvText);
    if (!rows.length) {
      return res.status(400).json({ error: "No data rows found in CSV" });
    }

    const stream = String(req.query.stream || "").toLowerCase() === "1";
    const emit = stream
      ? (event) => {
          res.write(`${JSON.stringify(event)}\n`);
        }
      : null;

    if (stream) {
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
      emitImportProgress(emit, {
        type: "start",
        total: rows.length,
        step: "validating",
        message: `Starting import of ${rows.length} customer(s)…`,
      });
    }

    const results = [];
    const batchSeen = {
      customerNumbers: new Set(),
      ipAddresses: new Set(),
      dstvSerials: new Set(),
    };
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (stream) {
        emitImportProgress(emit, {
          type: "row_start",
          line: row.line,
          index: index + 1,
          total: rows.length,
          step: "validating",
        });
      }

      try {
        const result = await importCustomerRowWithProgress(row, emit, batchSeen);
        results.push(result);
        if (stream) {
          emitImportProgress(emit, {
            type: "row_done",
            ...result,
          });
        }
      } catch (e) {
        const failure = {
          line: row.line,
          ok: false,
          error: e.message,
        };
        results.push(failure);
        if (stream) {
          emitImportProgress(emit, {
            type: "row_error",
            ...failure,
          });
        }
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    const summary = {
      ok: true,
      total: results.length,
      succeeded,
      failed: results.length - succeeded,
      results,
    };

    if (stream) {
      emitImportProgress(emit, {
        type: "complete",
        ...summary,
        step: "done",
      });
      return res.end();
    }

    return res.status(201).json(summary);
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function updateCustomer(req, res, next) {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    if (!body.firstName || !body.lastName) {
      return res.status(400).json({ error: "First name and last name are required" });
    }
    if (!body.phone) {
      return res.status(400).json({ error: "Phone is required" });
    }
    if (!body.email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const updated = await store.updateCustomerDetails(id, {
      firstName: body.firstName,
      lastName: body.lastName,
      middleName: body.middleName,
      phone: body.phone,
      email: body.email,
      isVatExempt: Boolean(body.isVatExempt),
      customerType: body.customerType,
      agencyId: body.agencyId,
      apartmentNumber: body.apartmentNumber,
      paymentFrequency: body.paymentFrequency,
      customPeriodDays: body.customPeriodDays,
      productId: body.productId,
      ipAddress: body.ipAddress,
      dstvDecoderSerial: body.dstvDecoderSerial,
    });

    let tispError = null;
    let zoho = { ok: true, skipped: true };
    if (updated?.status === "active") {
      try {
        const ctx = await store.getCustomerContext(id);
        await pushCustomerToTisp(ctx);
        await store.updateCustomerTispSync(id, "synced", null);
      } catch (e) {
        tispError = formatTispError(e);
        await store.updateCustomerTispSync(id, "failed", tispError);
      }
      zoho = await runZohoSyncForCustomer(id);
    }

    const customer = await store.getCustomerById(id);

    return res.json({
      ok: true,
      customer,
      tisp: tispError ? { ok: false, error: tispError } : { ok: true },
      zoho,
    });
  } catch (err) {
    if (err.message && !err.statusCode) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

async function convertCustomerTypeHandler(req, res, next) {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    const targetType = body.customerType;

    if (!targetType || !["C2B", "B2B"].includes(String(targetType).toUpperCase())) {
      return res.status(400).json({ error: "customerType must be C2B or B2B" });
    }

    let agencyId = body.agencyId ? Number(body.agencyId) : null;
    if (body.newAgency) {
      const { name, email, phone, contactPerson } = body.newAgency;
      if (!name || !email || !phone) {
        return res
          .status(400)
          .json({ error: "Agency name, email, and phone are required" });
      }
      agencyId = await store.createAgency({ name, email, phone, contactPerson });
    }

    const result = await store.convertCustomerType(id, targetType, agencyId);

    if (result.newType === "B2B" && result.agencyId) {
      try {
        const agency = await store.getAgencyById(result.agencyId);
        if (agency) {
          const { ensureZohoContactForAgency } = require("./agencies.controller");
          await ensureZohoContactForAgency(agency);
        }
      } catch (e) {
        console.warn("Agency Zoho provisioning after type conversion failed:", e.message);
      }
    }

    let tispError = null;
    if (result.customer?.status === "active") {
      try {
        const ctx = await store.getCustomerContext(id);
        await pushCustomerToTisp(ctx, {
          previousCustomerNumber: result.previousCustomerNumber,
        });
        await store.updateCustomerTispSync(id, "synced", null);
      } catch (e) {
        tispError = formatTispError(e);
        await store.updateCustomerTispSync(id, "failed", tispError);
      }
    }
    const zoho =
      result.customer?.status === "active"
        ? await runZohoSyncForCustomer(id)
        : { ok: true, skipped: true };

    const customer = await store.getCustomerById(id);

    try {
      await logActivity({
        eventType: "customer_type_changed",
        title: "Customer billing type changed",
        message: `${customer?.customerNumber}: ${result.previousType} → ${result.newType}${
          result.agencyName ? ` (${result.agencyName})` : ""
        }`,
        source: "tisp",
        status: tispError ? "failed" : "success",
        customerRef: customer?.customerNumber,
      });
    } catch (logErr) {
      console.error("activity log (type change) failed:", logErr.message);
    }

    return res.json({
      ok: true,
      ...result,
      customer,
      tisp: tispError ? { ok: false, error: tispError } : { ok: true },
      zoho,
    });
  } catch (err) {
    if (err.message && !err.statusCode) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

async function getCustomerPayments(req, res, next) {
  try {
    const customer = await store.getCustomerById(Number(req.params.id));
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const mpesaRows = await query(
      `SELECT id, amount, mpesa_receipt, phone, channel, status, created_at, transaction_date
       FROM payment_transactions
       WHERE account_reference = ? AND status = 'SUCCESS'
       ORDER BY COALESCE(transaction_date, created_at) DESC, id DESC
       LIMIT ?`,
      [customer.customerNumber, limit]
    );

    const payments = mpesaRows.map((row) => ({
      id: `mpesa-${row.id}`,
      source: "mpesa",
      amount: row.amount != null ? Number(row.amount) : null,
      referenceId: row.mpesa_receipt || null,
      phone: row.phone || null,
      channel: row.channel || null,
      status: row.status,
      invoiceNumber: null,
      paidAt: row.transaction_date || row.created_at,
    }));

    const mpesaRefs = new Set(
      payments
        .map((payment) => payment.referenceId?.trim().toLowerCase())
        .filter(Boolean)
    );

    const zohoContact = await findZohoContactForCustomer(customer);
    if (zohoContact?.contact_id) {
      const { getCustomerPayments_JS } = require("./zoho.controller");
      const zohoPayments = await getCustomerPayments_JS({
        customer_id: zohoContact.contact_id,
        per_page: limit,
      });

      for (const payment of zohoPayments || []) {
        const ref = payment.reference_number || payment.payment_number || null;
        if (ref && mpesaRefs.has(String(ref).trim().toLowerCase())) {
          continue;
        }

        const invoiceRef = Array.isArray(payment.invoices)
          ? payment.invoices.find((inv) => inv.invoice_number)?.invoice_number ||
            payment.invoices[0]?.invoice_number ||
            null
          : null;

        payments.push({
          id: `zoho-${payment.payment_id}`,
          source: "zoho",
          amount: payment.amount != null ? Number(payment.amount) : null,
          referenceId: payment.payment_number || String(payment.payment_id),
          phone: null,
          channel: payment.payment_mode || null,
          status: "received",
          invoiceNumber: invoiceRef,
          paidAt: payment.date || payment.payment_date || payment.created_time,
        });
      }
    }

    payments.sort(
      (a, b) => new Date(b.paidAt || 0).getTime() - new Date(a.paidAt || 0).getTime()
    );

    return res.json({ payments: payments.slice(0, limit) });
  } catch (err) {
    return next(err);
  }
}

async function getCustomerInvoices(req, res, next) {
  try {
    const customer = await store.getCustomerById(Number(req.params.id));
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const zoho = await fetchCustomerZohoInvoices(customer);
    return res.json({
      invoices: zoho.invoices,
      zohoLinked: zoho.linked,
      zohoContactId: zoho.zohoContactId,
      billedViaAgency: zoho.billedViaAgency || false,
      agencyName: zoho.agencyName || null,
      billingNote: zoho.billingNote || null,
      lastSyncedAt: zoho.lastSyncedAt || null,
      fromSnapshot: zoho.fromSnapshot === true,
      cacheFresh: zoho.cacheFresh === true,
    });
  } catch (err) {
    return next(err);
  }
}

async function retryBillingOnboarding(req, res, next) {
  try {
    const id = Number(req.params.id);
    const customer = await store.getCustomerById(id);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }
    if (customer.status === "cancelled") {
      return res
        .status(400)
        .json({ error: "Cannot retry billing for a cancelled customer" });
    }

    syncCooldown.assertSyncAllowed(id);
    invalidateCustomerZoho(id);

    try {
      const billing = await onboardNewCustomerBilling(id);
      if (!billing.ok) {
        return res.status(502).json({
          ok: false,
          error: billing.error || "Billing onboarding failed",
          billing,
        });
      }

      const [updatedCustomer, zoho] = await Promise.all([
        store.getCustomerById(id),
        fetchCustomerZohoInvoices(customer, { skipCache: true }),
      ]);

      try {
        const invoice = billing.invoice || {};
        await logActivity({
          eventType: invoice.created
            ? "zoho_billing_retry"
            : "zoho_billing_retry_linked",
          title: invoice.created
            ? "Billing onboarding retried — invoice created"
            : invoice.reused
              ? "Billing onboarding retried — existing invoice"
              : "Billing onboarding retried",
          message: invoice.invoiceNumber
            ? `${customer.customerNumber}: ${invoice.invoiceNumber}${
                invoice.emailed ? " — emailed" : ""
              }`
            : customer.customerNumber,
          source: "zoho",
          status: "success",
          customerRef: customer.customerNumber,
          amount: invoice.total ?? null,
          referenceId: invoice.invoiceId ?? null,
        });
      } catch (e) {
        console.error("retry billing activity log failed:", e.message);
      }

      return res.json({
        ok: true,
        billing,
        customer: updatedCustomer,
        zoho,
      });
    } finally {
      syncCooldown.recordSync(id);
    }
  } catch (err) {
    return next(err);
  }
}

async function refreshCustomerStatus(req, res, next) {
  try {
    const id = Number(req.params.id);
    let customer = await store.getCustomerById(id);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    syncCooldown.assertSyncAllowed(id);
    invalidateCustomerZoho(id);

    let tispRefreshed = false;
    try {
      const tispPromise =
        customer.status === "active"
          ? refreshTispStatus(customer).then(() => {
              tispRefreshed = true;
            })
          : Promise.resolve();

      const [, zoho, events, pendingUpgrade] = await Promise.all([
        tispPromise,
        fetchCustomerZohoInvoices(customer, { skipCache: true }),
        store.getCustomerEvents(id),
        pendingUpgradeStore.getActivePendingUpgrade(id),
      ]);

      await store.reconcileZohoBillingStatus(id, {
        linked: zoho?.linked,
        invoiceCount: zoho?.invoiceCount,
      });
      await store.reconcileTispSyncStatus(id);

      customer = await store.getCustomerById(id);

      return res.json({
        customer,
        events,
        pendingUpgrade,
        zoho,
        tisp: { refreshed: tispRefreshed },
      });
    } finally {
      syncCooldown.recordSync(id);
    }
  } catch (err) {
    return next(err);
  }
}

async function getCustomerTransactions(req, res, next) {
  try {
    const customer = await store.getCustomerById(Number(req.params.id));
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }
    req.query = { ...req.query, customerRef: customer.customerNumber };
    return listUnifiedTransactions(req, res, next);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listCustomers,
  exportCustomers,
  getCustomer,
  getCustomerTransactions,
  getCustomerInvoices,
  getCustomerPayments,
  refreshCustomerStatus,
  retryBillingOnboarding,
  getUpgradeQuote,
  createCustomer,
  updateCustomer,
  convertCustomerType: convertCustomerTypeHandler,
  upgradePackage,
  cancelPendingUpgrade,
  downgradePackage,
  changePaymentFrequency,
  switchApartment,
  cancelSubscription,
  deleteCustomerPermanently,
  bulkCancelSubscriptions,
  apartmentHistory,
  downloadImportTemplate,
  importCustomers,
  syncNewCustomerToTisp,
  pushCustomerToTisp,
  pushCustomerToZoho,
  ensureZohoContactForCustomer,
  buildZohoContactPayload,
};
