const crypto = require("crypto");
const { getPool, query } = require("../config/db");
const { validateIpForBuilding } = require("../config/buildingIpRules");
const catalogStore = require("./packageCatalogStore");
const { normalizeSubscriptionStatus } = require("../utils/subscriptionStatus");
const {
  formatDateOnly,
} = require("../utils/lastPaymentDate");
const { computeTrialEndDate } = require("../utils/billingPeriod");
const { formatProductNameForDisplay } = require("../utils/productNameDisplay");
const {
  buildCustomerNumber,
  liveCustomerNumber,
  archiveCancelledCustomerNumber,
  paybillRefTokens,
  pickUniquePaybillCustomer,
  normalizePremiseType,
  shopLocationCode,
} = require("../utils/customerNumber");

/** Keep sync error columns short — TISP often returns full HTML error pages. */
function sanitizeSyncError(message, maxLen = 240) {
  if (message == null || message === "") return null;
  return String(message)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen) || null;
}

function escapeLike(term) {
  return String(term).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * @param {string} term
 * @param {{ mode?: "fuzzy" | "exact" }} [options]
 * - fuzzy: substring match (default customers list)
 * - exact: billing gaps — exact CN/apt/name, or CN ending with the token
 *   (e.g. t506 → ET-T506). No starts-with prefixes (t50 must not hit T501–T506).
 */
function buildCustomerSearchFilter(term, options = {}) {
  const raw = String(term || "").trim();
  if (!raw || raw === "undefined") return null;

  const mode = options.mode === "exact" ? "exact" : "fuzzy";
  const upper = raw.toUpperCase();
  const compact = upper.replace(/[\s\-_/]+/g, "");

  if (mode === "exact") {
    // Hyphen boundary: ET-T506 matches t506 / T506; ET-T501 does not match t50.
    const hyphenSuffix = `%-${escapeLike(upper)}`;
    return {
      sql: `(
        UPPER(REPLACE(REPLACE(REPLACE(c.customer_number, '-', ''), ' ', ''), '_', '')) = ?
        OR UPPER(TRIM(c.customer_number)) = ?
        OR UPPER(TRIM(c.apartment_number)) = ?
        OR UPPER(TRIM(c.business_name)) = ?
        OR UPPER(TRIM(c.shop_location)) = ?
        OR UPPER(TRIM(CONCAT_WS(' ', c.first_name, c.middle_name, c.last_name))) = ?
        OR UPPER(TRIM(CONCAT_WS(' ', c.first_name, c.last_name))) = ?
        OR UPPER(TRIM(c.customer_number)) LIKE ?
        OR RIGHT(
          UPPER(REPLACE(REPLACE(REPLACE(c.customer_number, '-', ''), ' ', ''), '_', '')),
          ?
        ) = ?
      )`,
      params: [
        compact,
        upper,
        upper,
        upper,
        upper,
        upper,
        upper,
        hyphenSuffix,
        compact.length,
        compact,
      ],
    };
  }

  const escaped = escapeLike(raw);
  const like = `%${escaped}%`;
  const normalized = raw.toUpperCase().replace(/\s+/g, "");
  const likeNormalized = `%${escapeLike(normalized)}%`;
  const prefix = `${escapeLike(upper)}%`;

  // Prefer equality / prefix (index-friendly) before contains-anywhere name matches.
  return {
    sql: `(
      UPPER(TRIM(c.apartment_number)) = ?
      OR UPPER(TRIM(c.customer_number)) = ?
      OR UPPER(REPLACE(REPLACE(REPLACE(c.customer_number, '-', ''), ' ', ''), '_', '')) = ?
      OR UPPER(c.customer_number) LIKE ?
      OR UPPER(c.apartment_number) LIKE ?
      OR UPPER(c.business_name) LIKE ?
      OR UPPER(c.shop_location) LIKE ?
      OR UPPER(REPLACE(c.customer_number, '-', '')) LIKE ?
      OR RIGHT(
        UPPER(REPLACE(REPLACE(REPLACE(c.customer_number, '-', ''), ' ', ''), '_', '')),
        ?
      ) = ?
      OR c.first_name LIKE ?
      OR c.middle_name LIKE ?
      OR c.last_name LIKE ?
      OR CONCAT_WS(' ', c.first_name, c.middle_name, c.last_name) LIKE ?
    )`,
    params: [
      upper,
      upper,
      compact,
      prefix,
      prefix,
      prefix,
      prefix,
      likeNormalized,
      compact.length,
      compact,
      like,
      like,
      like,
      like,
    ],
  };
}

/** Random 7-char PPPoE password — letters, digits, and common specials. */
function generatePppoePassword() {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*_+-";
  let out = "";
  const bytes = crypto.randomBytes(7);
  for (let i = 0; i < 7; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function normalizePppoeUsername(value, fallback = null) {
  const username = String(value || "").trim().toUpperCase();
  if (username) return username;
  const fb = String(fallback || "").trim().toUpperCase();
  return fb || null;
}

function normalizePppoePassword(value, { required = false } = {}) {
  const password = String(value || "").trim();
  if (!password) {
    if (required) throw new Error("PPPoE password is required");
    return null;
  }
  // Printable ASCII excluding space (letters, numbers, special characters).
  if (!/^[\x21-\x7E]{4,50}$/.test(password)) {
    throw new Error(
      "PPPoE password must be 4–50 characters (letters, numbers, and special characters; no spaces)"
    );
  }
  return password;
}

function splitFullName(fullName) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return { first_name: "", middle_name: null, last_name: "" };
  }
  if (parts.length === 1) {
    return { first_name: parts[0], middle_name: null, last_name: parts[0] };
  }
  if (parts.length === 2) {
    return { first_name: parts[0], middle_name: null, last_name: parts[1] };
  }
  return {
    first_name: parts[0],
    middle_name: parts.slice(1, -1).join(" "),
    last_name: parts[parts.length - 1],
  };
}

/**
 * Free UNIQUE identity keys immediately after cancel so another tenant can
 * take the apartment number / IP / DSTV serial without waiting for signup.
 */
async function archiveCancelledCustomerIdentity(customerId, identity = {}) {
  const id = Number(customerId);
  if (!id) return null;
  const liveNumber = liveCustomerNumber(identity.customerNumber);
  if (!liveNumber) return null;
  const archived = archiveCancelledCustomerNumber(liveNumber, id);
  await query(
    `UPDATE customers
     SET customer_number = ?,
         ip_address = NULL,
         ppoe_username = NULL,
         dstv_decoder_serial = NULL
     WHERE id = ? AND status = 'cancelled'`,
    [archived, id]
  );
  return archived;
}

/**
 * Most recent cancelled tenant that held (or still holds) this apartment number.
 * Used when retiring the Zoho contact so the archived company_name matches local.
 */
async function findMostRecentCancelledTenantIdForNumber(
  customerNumber,
  excludeCustomerId = null
) {
  const base = liveCustomerNumber(customerNumber);
  if (!base) return null;

  const params = [base, `${base}-CXL-%`];
  let excludeSql = "";
  if (excludeCustomerId != null && Number(excludeCustomerId) > 0) {
    excludeSql = " AND id <> ?";
    params.push(Number(excludeCustomerId));
  }

  const rows = await query(
    `SELECT id
     FROM customers
     WHERE status = 'cancelled'
       AND (
         UPPER(TRIM(customer_number)) = ?
         OR UPPER(TRIM(customer_number)) LIKE ?
       )
     ${excludeSql}
     ORDER BY id DESC
     LIMIT 1`,
    params
  );
  return rows[0]?.id ? Number(rows[0].id) : null;
}

/**
 * Cancelled tenant whose number was archived for apartment reuse
 * ({base}-CXL-{id}). Used to detect real changeovers — not mere Zoho history.
 */
async function findArchivedCancelledTenantIdForNumber(
  customerNumber,
  excludeCustomerId = null
) {
  const base = liveCustomerNumber(customerNumber);
  if (!base) return null;

  const params = [`${base}-CXL-%`];
  let excludeSql = "";
  if (excludeCustomerId != null && Number(excludeCustomerId) > 0) {
    excludeSql = " AND id <> ?";
    params.push(Number(excludeCustomerId));
  }

  const rows = await query(
    `SELECT id
     FROM customers
     WHERE status = 'cancelled'
       AND UPPER(TRIM(customer_number)) LIKE ?
     ${excludeSql}
     ORDER BY id DESC
     LIMIT 1`,
    params
  );
  return rows[0]?.id ? Number(rows[0].id) : null;
}

/**
 * Cancelled customers may still occupy UNIQUE keys (customer_number, ip_address,
 * dstv_decoder_serial) if they were cancelled before eager archive. Free those
 * keys when a new/active signup needs them. Active holders still block.
 */
async function releaseCancelledIdentityForReuse({
  customerNumber = null,
  ipAddress = null,
  dstvDecoderSerial = null,
  excludeCustomerId = null,
} = {}) {
  const number = String(customerNumber || "").trim();
  if (number) {
    const holders = await query(
      `SELECT id, customer_number, status
       FROM customers
       WHERE customer_number = ?
       LIMIT 5`,
      [number]
    );
    for (const row of holders) {
      if (excludeCustomerId && Number(row.id) === Number(excludeCustomerId)) {
        continue;
      }
      if (row.status === "active") {
        throw new Error(
          `Customer number already exists for this apartment (${row.customer_number})`
        );
      }
      const archived = archiveCancelledCustomerNumber(row.customer_number, row.id);
      await query(
        `UPDATE customers
         SET customer_number = ?,
             ip_address = NULL,
             ppoe_username = NULL,
             dstv_decoder_serial = NULL
         WHERE id = ? AND status = 'cancelled'`,
        [archived, row.id]
      );
    }
  }

  const ip = ipAddress ? String(ipAddress).trim() : "";
  if (ip) {
    const holders = await query(
      `SELECT id, customer_number, status
       FROM customers
       WHERE ip_address = ?
       LIMIT 5`,
      [ip]
    );
    for (const row of holders) {
      if (excludeCustomerId && Number(row.id) === Number(excludeCustomerId)) {
        continue;
      }
      if (row.status === "active") {
        throw new Error(
          `IP address ${ip} is already assigned to ${row.customer_number}`
        );
      }
      await query(
        `UPDATE customers
         SET ip_address = NULL
         WHERE id = ? AND status = 'cancelled'`,
        [row.id]
      );
    }
  }

  const serial = normalizeDstvDecoderSerial(dstvDecoderSerial);
  if (serial) {
    const holders = await query(
      `SELECT id, customer_number, first_name, middle_name, last_name, status
       FROM customers
       WHERE dstv_decoder_serial = ?
       LIMIT 5`,
      [serial]
    );
    for (const row of holders) {
      if (excludeCustomerId && Number(row.id) === Number(excludeCustomerId)) {
        continue;
      }
      if (row.status === "active") {
        const name = [row.first_name, row.middle_name, row.last_name]
          .filter(Boolean)
          .join(" ");
        throw new Error(
          `DSTV decoder serial is already assigned to ${name} (${row.customer_number})`
        );
      }
      await query(
        `UPDATE customers
         SET dstv_decoder_serial = NULL
         WHERE id = ? AND status = 'cancelled'`,
        [row.id]
      );
    }
  }
}

const DAYS_PER_MONTH = 30;

function resolvePackagePrice(product, paymentFrequency, customPeriodDays) {
  const monthly = Number(product.monthly_price);
  if (paymentFrequency === "monthly") return Number(product.price);
  if (paymentFrequency === "quarterly") return Number(product.price);
  if (paymentFrequency === "yearly") return Number(product.price);
  if (paymentFrequency === "custom") {
    const days = Number(customPeriodDays);
    if (!days || days < 1) {
      throw new Error("Custom period must be at least 1 day");
    }
    return Math.round((monthly * days) / DAYS_PER_MONTH);
  }
  throw new Error("Invalid payment frequency");
}

/**
 * Decoder one-time fee flags for a product (signup / first DSTV invoice).
 * Returns { required: 0|1, amount: number|null }.
 */
async function resolveDecoderFeeForProduct(product, building = null) {
  const { buildingUsesDecoder } = require("../utils/dstvSetup");
  if (building && !buildingUsesDecoder(building)) {
    return { required: 0, amount: null };
  }
  const productHasDstv = Boolean(product?.has_dstv || product?.hasDstv);
  const envFee = Number(process.env.ZOHO_DSTV_ONE_TIME_FEE || 2900);
  if (product?.plan_variant_id) {
    const variant = await catalogStore.getPlanVariantDetails(
      product.plan_variant_id
    );
    if (variant?.requiresDecoderFee || variant?.hasDstv || productHasDstv) {
      return {
        required: 1,
        amount:
          variant.decoderFeeAmount != null
            ? Number(variant.decoderFeeAmount)
            : envFee,
      };
    }
  } else if (productHasDstv) {
    return { required: 1, amount: envFee };
  }
  return { required: 0, amount: null };
}

function mapCustomerRow(row) {
  if (!row) return null;
  const buildingDstvSetup = row.building_dstv_setup || "decoder";
  const dstvSerialRequired = Boolean(row.product_has_dstv) && buildingDstvSetup === "decoder";
  return {
    id: row.id,
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    fullName: [row.first_name, row.middle_name, row.last_name]
      .filter(Boolean)
      .join(" "),
    phone: row.phone,
    email: row.email,
    billingAttention: row.billing_attention || null,
    billingAddress: row.billing_address || null,
    billingStreet2: row.billing_street2 || null,
    billingCity: row.billing_city || null,
    billingState: row.billing_state || null,
    billingZip: row.billing_zip || null,
    billingCountry: row.billing_country || null,
    ipAddress: row.ip_address,
    isVatExempt: Boolean(row.is_vat_exempt),
    customerType: row.customer_type,
    premiseType: normalizePremiseType(row.premise_type),
    apartmentNumber: row.apartment_number,
    businessName: row.business_name || null,
    shopLocation: row.shop_location || null,
    paymentFrequency: row.payment_frequency,
    customPeriodDays: row.custom_period_days,
    buildingId: row.building_id,
    buildingName: row.building_name,
    popId: row.pop_id != null ? Number(row.pop_id) : null,
    popName: row.pop_name || null,
    c2bCode: row.c2b_code || null,
    b2bCode: row.b2b_code || null,
    productId: row.product_id,
    productName: catalogStore.isDstvOnlyCategory(row.category_code)
      ? catalogStore.DSTV_ONLY_PRODUCT_NAME
      : row.product_name,
    productMbps: catalogStore.isDstvOnlyCategory(row.category_code)
      ? 0
      : row.product_mbps,
    productExtraBandwidth: catalogStore.isDstvOnlyCategory(row.category_code)
      ? 0
      : row.product_extra_bandwidth,
    planId: row.plan_id != null ? Number(row.plan_id) : null,
    planName: catalogStore.isDstvOnlyCategory(row.category_code)
      ? catalogStore.DSTV_ONLY_PRODUCT_NAME
      : row.plan_name || null,
    planSortOrder: row.plan_sort_order != null ? Number(row.plan_sort_order) : null,
    planVariantId: row.plan_variant_id != null ? Number(row.plan_variant_id) : null,
    categoryId: row.category_id != null ? Number(row.category_id) : null,
    categoryCode: row.category_code || null,
    categoryName: row.category_name || null,
    /** Product is not linked to the current package catalog (plan + category). */
    catalogPackageMissing: !(
      row.plan_variant_id != null &&
      row.plan_id != null &&
      row.category_id != null &&
      String(row.plan_name || "").trim() &&
      String(row.category_name || "").trim()
    ),
    agencyId: row.agency_id,
    agencyName: row.agency_name,
    agencyEmail: row.agency_email || null,
    agencyPhone: row.agency_phone || null,
    customerNumber: row.customer_number,
    ipSetup: row.ip_setup || row.building_ip_setup || null,
    ppoeUsername: row.ppoe_username || null,
    buildingOltId: row.building_olt_id != null ? Number(row.building_olt_id) : null,
    buildingOltName: row.building_olt_name || null,
    buildingOltHost: row.building_olt_host || null,
    buildingOltPort:
      row.building_olt_port != null ? Number(row.building_olt_port) : null,
    buildingOltMac: row.building_olt_mac || null,
    buildingOltUsername: row.building_olt_username || null,
    buildingOltConfigured: Boolean(
      row.building_olt_host &&
        row.building_olt_mac &&
        row.building_olt_username &&
        row.building_olt_password
    ),
    oltMac: row.olt_mac || row.building_olt_mac || null,
    onuIndexStr: row.onu_index_str || null,
    onuSn: row.onu_sn || null,
    tispPassword: row.tisp_password || null,
    packagePrice: Number(row.package_price),
    decoderFeeAmount:
      row.decoder_fee_amount != null ? Number(row.decoder_fee_amount) : null,
    decoderFeeRequired: Boolean(row.decoder_fee_required),
    hasDstv: Boolean(row.product_has_dstv),
    buildingDstvSetup,
    dstvSerialRequired,
    dstvDecoderSerial: row.dstv_decoder_serial || null,
    dstvSerialMissing: dstvSerialRequired && !String(row.dstv_decoder_serial || "").trim(),
    subscriptionStatus: normalizeSubscriptionStatus(row.subscription_status),
    tispSyncStatus: row.tisp_sync_status || "pending",
    tispSyncError: sanitizeSyncError(row.tisp_sync_error),
    zohoBillingStatus: row.zoho_billing_status || "pending",
    zohoBillingError: sanitizeSyncError(row.zoho_billing_error),
    zohoSignupInvoiceId: row.zoho_signup_invoice_id || null,
    zohoSignupInvoiceEmailedAt: row.zoho_signup_invoice_emailed_at || null,
    trialPeriodEnabled: Boolean(row.trial_period_enabled),
    trialEndsAt: row.trial_ends_at || null,
    referredByCustomerId:
      row.referred_by_customer_id != null
        ? Number(row.referred_by_customer_id)
        : null,
    campaignId: row.campaign_id != null ? Number(row.campaign_id) : null,
    lastPaymentDate: row.last_payment_date
      ? String(row.last_payment_date).slice(0, 10)
      : null,
    tispDueDate: row.tisp_due_date ? String(row.tisp_due_date) : null,
    status: row.status,
    cancellationReason: row.cancellation_reason || null,
    onuCollectedAt: row.onu_collected_at
      ? String(row.onu_collected_at).slice(0, 10)
      : null,
    dstvDecoderCollectedAt: row.dstv_decoder_collected_at
      ? String(row.dstv_decoder_collected_at).slice(0, 10)
      : null,
    pauseStartDate: row.pause_start_date
      ? String(row.pause_start_date).slice(0, 10)
      : null,
    pauseEndDate: row.pause_end_date
      ? String(row.pause_end_date).slice(0, 10)
      : null,
    pauseReason: row.pause_reason || null,
    pauseCreditDays:
      row.pause_credit_days != null ? Number(row.pause_credit_days) : null,
    pauseOriginalDueDate: row.pause_original_due_date
      ? String(row.pause_original_due_date).slice(0, 10)
      : null,
    pauseCreditedDueDate: row.pause_credited_due_date
      ? String(row.pause_credited_due_date).slice(0, 10)
      : null,
    pauseCreditAppliedAt: row.pause_credit_applied_at
      ? String(row.pause_credit_applied_at)
      : null,
    upgradePaymentStatus: row.upgrade_payment_status || "none",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const LAST_PAYMENT_SORT_EXPR = `COALESCE(c.last_payment_date, '1000-01-01')`;

const CUSTOMER_SELECT = `
  SELECT c.*,
         b.name AS building_name,
         b.pop_id AS pop_id,
         pop.name AS pop_name,
         pop.c2b_code AS c2b_code,
         pop.b2b_code AS b2b_code,
         pop.ip_setup AS ip_setup,
         pop.dstv_setup AS building_dstv_setup,
         bo.id AS linked_building_olt_id,
         bo.name AS building_olt_name,
         bo.host AS building_olt_host,
         bo.port AS building_olt_port,
         bo.mac AS building_olt_mac,
         bo.username AS building_olt_username,
         bo.password AS building_olt_password,
         bo.tenant_id AS building_olt_tenant_id,
         p.name AS product_name,
         p.mbps AS product_mbps,
         p.extra_bandwidth AS product_extra_bandwidth,
         p.has_dstv AS product_has_dstv,
         p.plan_variant_id AS plan_variant_id,
         pl.id AS plan_id,
         pl.name AS plan_name,
         pl.sort_order AS plan_sort_order,
         cat.id AS category_id,
         cat.code AS category_code,
         cat.name AS category_name,
         a.name AS agency_name,
         a.email AS agency_email,
         a.phone AS agency_phone,
         a.contact_person AS agency_contact_person,
         ts.due_date AS tisp_due_date
  FROM customers c
  JOIN buildings b ON b.id = c.building_id
  JOIN pops pop ON pop.id = b.pop_id
  JOIN products p ON p.id = c.product_id
  LEFT JOIN pop_olts bo ON bo.id = c.building_olt_id
  LEFT JOIN agencies a ON a.id = c.agency_id
  LEFT JOIN package_plan_variants v ON v.id = p.plan_variant_id
  LEFT JOIN package_plans pl ON pl.id = v.plan_id
  LEFT JOIN package_categories cat ON cat.id = pl.category_id
  LEFT JOIN tisp_customer_snapshots ts ON ts.customer_id = c.id
`;

async function listBuildings(filters = {}) {
  const clauses = ["1=1"];
  const params = [];
  if (filters.search) {
    const q = `%${String(filters.search).trim()}%`;
    clauses.push(
      "(b.name LIKE ? OR b.building_code LIKE ? OR p.name LIKE ? OR p.c2b_code LIKE ? OR p.b2b_code LIKE ?)"
    );
    params.push(q, q, q, q, q);
  }
  if (filters.ipSetup) {
    clauses.push("p.ip_setup = ?");
    params.push(filters.ipSetup);
  }
  if (filters.popId) {
    clauses.push("b.pop_id = ?");
    params.push(Number(filters.popId));
  }

  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
  const offset = (page - 1) * limit;

  const { resolveListSort } = require("../utils/listSort");
  const sort = resolveListSort(filters, {
    allowed: [
      { key: "name", sql: "b.name" },
      { key: "popName", sql: "p.name" },
      { key: "c2bCode", sql: "p.c2b_code" },
      { key: "b2bCode", sql: "p.b2b_code" },
      { key: "ipSetup", sql: "p.ip_setup" },
      { key: "createdAt", sql: "b.created_at" },
    ],
    defaultSort: { sortBy: "name", sortDir: "asc" },
  });

  const [countRow] = await query(
    `SELECT COUNT(*) AS total
     FROM buildings b
     JOIN pops p ON p.id = b.pop_id
     WHERE ${clauses.join(" AND ")}`,
    params
  );

  const rows = await query(
    `SELECT b.id, b.pop_id, b.name,
            b.address_attention, b.address_street, b.address_street2, b.address_po_box,
            b.address_city, b.address_state, b.address_zip, b.address_country,
            b.building_code, b.ip_prefixes, b.created_at,
            p.name AS pop_name,
            p.c2b_code, p.b2b_code, p.ip_setup, p.dstv_setup,
            p.ip_prefixes AS pop_ip_prefixes
     FROM buildings b
     JOIN pops p ON p.id = b.pop_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY ${sort.orderClause} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const popIds = [...new Set(rows.map((r) => r.pop_id).filter(Boolean))];
  let oltsByPop = new Map();
  if (popIds.length) {
    const placeholders = popIds.map(() => "?").join(",");
    const oltRows = await query(
      `SELECT * FROM pop_olts
       WHERE pop_id IN (${placeholders})
       ORDER BY pop_id, id`,
      popIds
    );
    for (const row of oltRows) {
      const list = oltsByPop.get(row.pop_id) || [];
      list.push(mapPopOltRow(row));
      oltsByPop.set(row.pop_id, list);
    }
  }

  const buildings = rows.map((r) =>
    mapBuildingRow(r, oltsByPop.get(r.pop_id) || [])
  );
  return {
    buildings,
    data: buildings,
    pagination: {
      page,
      limit,
      total: Number(countRow.total),
      pages: Math.ceil(Number(countRow.total) / limit) || 1,
    },
  };
}

function normalizeOltMac(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  const hex = raw.replace(/[^0-9a-f]/g, "");
  if (hex.length !== 12) {
    throw new Error("OLT MAC must be 12 hex digits (e.g. 6c:68:a4:ee:93:74)");
  }
  return hex.match(/.{1,2}/g).join(":");
}

function normalizeOltHost(value) {
  const host = String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");
  return host || null;
}

function mapPopOltRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    popId: row.pop_id != null ? Number(row.pop_id) : null,
    // Legacy alias — OLT belongs to POP, not building
    buildingId: row.pop_id != null ? Number(row.pop_id) : null,
    name: row.name || null,
    host: row.host,
    port: row.port != null ? Number(row.port) : 38881,
    mac: row.mac,
    username: row.username,
    tenantId: row.tenant_id || "000000",
    passwordConfigured: Boolean(String(row.password || "").trim()),
    isActive: row.is_active == null ? true : Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** @deprecated Use mapPopOltRow */
const mapBuildingOltRow = mapPopOltRow;

function mapBuildingRow(row, olts = []) {
  return {
    id: row.id,
    popId: row.pop_id != null ? Number(row.pop_id) : null,
    popName: row.pop_name || null,
    name: row.name,
    buildingCode: row.building_code || null,
    c2bCode: row.c2b_code,
    b2bCode: row.b2b_code,
    ipSetup: row.ip_setup,
    dstvSetup: row.dstv_setup || "decoder",
    olts: Array.isArray(olts) ? olts : [],
    oltCount: Array.isArray(olts) ? olts.length : 0,
    ipPrefixes: parseBuildingPrefixes(row.ip_prefixes),
    popIpPrefixes: parseBuildingPrefixes(row.pop_ip_prefixes),
    addressAttention: row.address_attention || null,
    addressStreet: row.address_street || null,
    addressStreet2: row.address_street2 || null,
    addressPoBox: row.address_po_box || null,
    addressCity: row.address_city || null,
    addressState: row.address_state || null,
    addressZip: row.address_zip || null,
    addressCountry: row.address_country || null,
    createdAt: row.created_at,
  };
}

function mapPopRow(row, olts = []) {
  return {
    id: row.id,
    name: row.name,
    c2bCode: row.c2b_code,
    b2bCode: row.b2b_code,
    ipSetup: row.ip_setup,
    dstvSetup: row.dstv_setup || "decoder",
    ipPrefixes: parseBuildingPrefixes(row.ip_prefixes),
    olts: Array.isArray(olts) ? olts : [],
    oltCount: Array.isArray(olts) ? olts.length : 0,
    buildingCount:
      row.building_count != null ? Number(row.building_count) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseBuildingPrefixes(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function assertPrefixesSubsetOfPop(assigned, popPrefixes, popName) {
  const pool = new Set(popPrefixes || []);
  for (const prefix of assigned || []) {
    if (!pool.has(prefix)) {
      throw new Error(
        `Prefix ${prefix} is not in the ${popName || "POP"} IP pool`
      );
    }
  }
}

function normalizeBuildingCode(raw) {
  const code = String(raw || "")
    .trim()
    .toUpperCase();
  if (!code) return null;
  if (!/^[A-Z0-9]{1,10}$/.test(code)) {
    throw new Error("Building code must be 1–10 alphanumeric characters");
  }
  return code;
}

async function listPops(filters = {}) {
  const clauses = ["1=1"];
  const params = [];
  if (filters.search) {
    const q = `%${String(filters.search).trim()}%`;
    clauses.push("(name LIKE ? OR c2b_code LIKE ? OR b2b_code LIKE ?)");
    params.push(q, q, q);
  }
  if (filters.ipSetup) {
    clauses.push("ip_setup = ?");
    params.push(filters.ipSetup);
  }

  const rows = await query(
    `SELECT p.*,
            (SELECT COUNT(*) FROM buildings b WHERE b.pop_id = p.id) AS building_count
     FROM pops p
     WHERE ${clauses.join(" AND ")}
     ORDER BY p.name ASC`,
    params
  );

  const popIds = rows.map((r) => r.id);
  let oltsByPop = new Map();
  if (popIds.length) {
    const placeholders = popIds.map(() => "?").join(",");
    const oltRows = await query(
      `SELECT * FROM pop_olts WHERE pop_id IN (${placeholders}) ORDER BY pop_id, id`,
      popIds
    );
    for (const row of oltRows) {
      const list = oltsByPop.get(row.pop_id) || [];
      list.push(mapPopOltRow(row));
      oltsByPop.set(row.pop_id, list);
    }
  }

  const pops = rows.map((r) => mapPopRow(r, oltsByPop.get(r.id) || []));
  return { pops, data: pops };
}

async function getPopById(id) {
  const rows = await query(`SELECT * FROM pops WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

async function getPopMapped(id) {
  const row = await getPopById(id);
  if (!row) return null;
  const olts = await listPopOlts(id);
  const [countRow] = await query(
    `SELECT COUNT(*) AS building_count FROM buildings WHERE pop_id = ?`,
    [id]
  );
  return mapPopRow(
    { ...row, building_count: countRow?.building_count || 0 },
    olts
  );
}

async function createPop(data) {
  const { normalizeIpPrefixes } = require("../config/buildingIpRules");
  const name = String(data.name || "").trim();
  const c2bCode = String(data.c2bCode || "").trim().toUpperCase();
  const b2bCode = String(data.b2bCode || "").trim().toUpperCase();
  const ipSetup = data.ipSetup;
  const dstvSetup = data.dstvSetup || "decoder";

  if (!name || !c2bCode || !b2bCode) {
    throw new Error("Name, C2B code, and B2B code are required");
  }
  if (!["STATIC", "PPOE"].includes(ipSetup)) {
    throw new Error("IP setup must be STATIC or PPOE");
  }
  if (!["headend_coax", "decoder"].includes(dstvSetup)) {
    throw new Error("DSTV setup must be headend_coax or decoder");
  }
  if (!/^[A-Z0-9]{2,10}$/.test(c2bCode) || !/^[A-Z0-9]{2,10}$/.test(b2bCode)) {
    throw new Error("Codes must be 2–10 alphanumeric characters");
  }

  let ipPrefixes = [];
  if (ipSetup === "STATIC") {
    ipPrefixes = normalizeIpPrefixes(data.ipPrefixes || []);
  }

  const result = await query(
    `INSERT INTO pops (name, c2b_code, b2b_code, ip_setup, dstv_setup, ip_prefixes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, c2bCode, b2bCode, ipSetup, dstvSetup, JSON.stringify(ipPrefixes)]
  );
  return result.insertId;
}

async function updatePop(id, data) {
  const { normalizeIpPrefixes } = require("../config/buildingIpRules");
  const existing = await getPopById(id);
  if (!existing) throw new Error("POP not found");

  const name = data.name !== undefined ? String(data.name).trim() : existing.name;
  const c2bCode =
    data.c2bCode !== undefined
      ? String(data.c2bCode).trim().toUpperCase()
      : existing.c2b_code;
  const b2bCode =
    data.b2bCode !== undefined
      ? String(data.b2bCode).trim().toUpperCase()
      : existing.b2b_code;
  const ipSetup = data.ipSetup !== undefined ? data.ipSetup : existing.ip_setup;
  const dstvSetup =
    data.dstvSetup !== undefined ? data.dstvSetup : existing.dstv_setup || "decoder";

  if (!name || !c2bCode || !b2bCode) {
    throw new Error("Name, C2B code, and B2B code are required");
  }
  if (!["STATIC", "PPOE"].includes(ipSetup)) {
    throw new Error("IP setup must be STATIC or PPOE");
  }
  if (!["headend_coax", "decoder"].includes(dstvSetup)) {
    throw new Error("DSTV setup must be headend_coax or decoder");
  }
  if (!/^[A-Z0-9]{2,10}$/.test(c2bCode) || !/^[A-Z0-9]{2,10}$/.test(b2bCode)) {
    throw new Error("Codes must be 2–10 alphanumeric characters");
  }

  let ipPrefixes = parseBuildingPrefixes(existing.ip_prefixes);
  if (data.ipPrefixes !== undefined) {
    if (ipSetup === "PPOE") {
      ipPrefixes = [];
    } else {
      const normalized = normalizeIpPrefixes(data.ipPrefixes || []);
      if (normalized.length > 0 || Array.isArray(data.ipPrefixes)) {
        ipPrefixes = normalized;
      }
    }
  } else if (ipSetup === "PPOE") {
    ipPrefixes = [];
  }

  // Ensure building assignments remain a subset of the POP pool
  const buildings = await query(
    `SELECT id, name, ip_prefixes FROM buildings WHERE pop_id = ?`,
    [id]
  );
  const pool = new Set(ipPrefixes);
  for (const b of buildings) {
    const assigned = parseBuildingPrefixes(b.ip_prefixes);
    const nextAssigned = assigned.filter((p) => pool.has(p));
    if (nextAssigned.length !== assigned.length || ipSetup === "PPOE") {
      await query(`UPDATE buildings SET ip_prefixes = ? WHERE id = ?`, [
        JSON.stringify(ipSetup === "PPOE" ? [] : nextAssigned),
        b.id,
      ]);
    }
  }

  await query(
    `UPDATE pops
     SET name = ?, c2b_code = ?, b2b_code = ?, ip_setup = ?, dstv_setup = ?, ip_prefixes = ?
     WHERE id = ?`,
    [name, c2bCode, b2bCode, ipSetup, dstvSetup, JSON.stringify(ipPrefixes), id]
  );
}

async function createBuilding(data) {
  const { normalizeIpPrefixes } = require("../config/buildingIpRules");
  const {
    normalizeBuildingAddressFields,
  } = require("../utils/buildingBillingAddress");
  const name = String(data.name || "").trim();
  const popId = Number(data.popId);
  const address = normalizeBuildingAddressFields(data);
  const addressCountry =
    address.addressAttention ||
    address.addressStreet ||
    address.addressStreet2 ||
    address.addressPoBox ||
    address.addressCity ||
    address.addressState ||
    address.addressZip ||
    address.addressCountry
      ? address.addressCountry || "Kenya"
      : null;

  if (!name) throw new Error("Building name is required");
  if (!popId) throw new Error("POP is required");

  const pop = await getPopById(popId);
  if (!pop) throw new Error("POP not found");

  const buildingCode =
    data.buildingCode !== undefined
      ? normalizeBuildingCode(data.buildingCode)
      : null;

  let ipPrefixes = [];
  if (String(pop.ip_setup).toUpperCase() === "STATIC") {
    ipPrefixes = normalizeIpPrefixes(data.ipPrefixes || []);
    assertPrefixesSubsetOfPop(
      ipPrefixes,
      parseBuildingPrefixes(pop.ip_prefixes),
      pop.name
    );
  }

  const result = await query(
    `INSERT INTO buildings (
       pop_id, name, building_code, address_attention, address_street, address_street2, address_po_box,
       address_city, address_state, address_zip, address_country, ip_prefixes
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      popId,
      name,
      buildingCode,
      address.addressAttention,
      address.addressStreet,
      address.addressStreet2,
      address.addressPoBox,
      address.addressCity,
      address.addressState,
      address.addressZip,
      addressCountry,
      JSON.stringify(ipPrefixes),
    ]
  );

  return result.insertId;
}

async function updateBuilding(id, data) {
  const { normalizeIpPrefixes } = require("../config/buildingIpRules");
  const {
    normalizeBuildingAddressFields,
  } = require("../utils/buildingBillingAddress");
  const existing = await getBuildingById(id);
  if (!existing) throw new Error("Building not found");

  const name = data.name !== undefined ? String(data.name).trim() : existing.name;
  const popId =
    data.popId !== undefined ? Number(data.popId) : Number(existing.pop_id);

  if (!name) throw new Error("Building name is required");
  if (!popId) throw new Error("POP is required");

  const pop = await getPopById(popId);
  if (!pop) throw new Error("POP not found");

  const buildingCode =
    data.buildingCode !== undefined
      ? normalizeBuildingCode(data.buildingCode)
      : existing.building_code || null;

  const addressIncoming = normalizeBuildingAddressFields(data);
  const pickAddress = (key, column) =>
    data[key] !== undefined ? addressIncoming[key] : existing[column] || null;
  const addressAttention = pickAddress("addressAttention", "address_attention");
  const addressStreet = pickAddress("addressStreet", "address_street");
  const addressStreet2 = pickAddress("addressStreet2", "address_street2");
  const addressPoBox = pickAddress("addressPoBox", "address_po_box");
  const addressCity = pickAddress("addressCity", "address_city");
  const addressState = pickAddress("addressState", "address_state");
  const addressZip = pickAddress("addressZip", "address_zip");
  const hasAddress =
    addressAttention ||
    addressStreet ||
    addressStreet2 ||
    addressPoBox ||
    addressCity ||
    addressState ||
    addressZip ||
    (data.addressCountry !== undefined
      ? addressIncoming.addressCountry
      : existing.address_country);
  const addressCountry = hasAddress
    ? data.addressCountry !== undefined
      ? addressIncoming.addressCountry || "Kenya"
      : existing.address_country || "Kenya"
    : null;

  let ipPrefixes = parseBuildingPrefixes(existing.ip_prefixes);
  if (String(pop.ip_setup).toUpperCase() === "PPOE") {
    ipPrefixes = [];
  } else if (data.ipPrefixes !== undefined) {
    ipPrefixes = normalizeIpPrefixes(data.ipPrefixes || []);
    assertPrefixesSubsetOfPop(
      ipPrefixes,
      parseBuildingPrefixes(pop.ip_prefixes),
      pop.name
    );
  } else if (Number(popId) !== Number(existing.pop_id)) {
    // Moving POP: drop assignments that aren't in the new pool
    const pool = new Set(parseBuildingPrefixes(pop.ip_prefixes));
    ipPrefixes = ipPrefixes.filter((p) => pool.has(p));
  }

  await query(
    `UPDATE buildings
     SET pop_id = ?, name = ?, building_code = ?,
         address_attention = ?, address_street = ?, address_street2 = ?,
         address_po_box = ?, address_city = ?, address_state = ?,
         address_zip = ?, address_country = ?, ip_prefixes = ?
     WHERE id = ?`,
    [
      popId,
      name,
      buildingCode,
      addressAttention,
      addressStreet,
      addressStreet2,
      addressPoBox,
      addressCity,
      addressState,
      addressZip,
      addressCountry,
      JSON.stringify(ipPrefixes),
      id,
    ]
  );
}

async function getBuildingById(id) {
  const rows = await query(
    `SELECT b.*,
            p.name AS pop_name,
            p.c2b_code, p.b2b_code, p.ip_setup, p.dstv_setup,
            p.ip_prefixes AS pop_ip_prefixes
     FROM buildings b
     JOIN pops p ON p.id = b.pop_id
     WHERE b.id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function listPopOlts(popId) {
  const rows = await query(
    `SELECT * FROM pop_olts WHERE pop_id = ? ORDER BY id`,
    [popId]
  );
  return rows.map(mapPopOltRow);
}

async function listBuildingOlts(buildingId) {
  const building = await getBuildingById(buildingId);
  if (!building) return [];
  return listPopOlts(building.pop_id);
}

async function getPopOltById(id) {
  const rows = await query(`SELECT * FROM pop_olts WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

/** @deprecated Use getPopOltById */
async function getBuildingOltById(id) {
  return getPopOltById(id);
}

async function createPopOlt(popId, data) {
  const pop = await getPopById(popId);
  if (!pop) throw new Error("POP not found");

  const host = normalizeOltHost(data.host ?? data.oltHost);
  const mac = normalizeOltMac(data.mac ?? data.oltMac);
  const username = String(data.username ?? data.oltUsername ?? "").trim();
  const password = String(data.password ?? data.oltPassword ?? "");
  const tenantId =
    String(data.tenantId ?? data.oltTenantId ?? "000000").trim() || "000000";
  const port =
    data.port != null && String(data.port).trim() !== ""
      ? Number(data.port)
      : 38881;
  const name = data.name != null ? String(data.name).trim() || null : null;

  if (!host) throw new Error("OLT host is required");
  if (!mac) throw new Error("OLT MAC is required");
  if (!username) throw new Error("OLT username is required");
  if (!password.trim()) throw new Error("OLT password is required");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("OLT port must be between 1 and 65535");
  }

  try {
    const result = await query(
      `INSERT INTO pop_olts
        (pop_id, name, host, port, mac, username, password, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [popId, name, host, port, mac, username, password, tenantId]
    );
    return getPopOltById(result.insertId);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      throw new Error("An OLT with this MAC already exists on this POP");
    }
    throw err;
  }
}

async function createBuildingOlt(buildingId, data) {
  const building = await getBuildingById(buildingId);
  if (!building) throw new Error("Building not found");
  return createPopOlt(building.pop_id, data);
}

async function updatePopOlt(id, data) {
  const existing = await getPopOltById(id);
  if (!existing) throw new Error("OLT not found");

  const host =
    data.host !== undefined || data.oltHost !== undefined
      ? normalizeOltHost(data.host ?? data.oltHost)
      : existing.host;
  const mac =
    data.mac !== undefined || data.oltMac !== undefined
      ? normalizeOltMac(data.mac ?? data.oltMac)
      : existing.mac;
  const username =
    data.username !== undefined || data.oltUsername !== undefined
      ? String(data.username ?? data.oltUsername ?? "").trim()
      : existing.username;
  let password = existing.password;
  if (data.password !== undefined || data.oltPassword !== undefined) {
    const incoming = String(data.password ?? data.oltPassword ?? "");
    if (incoming.trim()) password = incoming;
  }
  const tenantId =
    data.tenantId !== undefined || data.oltTenantId !== undefined
      ? String(data.tenantId ?? data.oltTenantId ?? "000000").trim() || "000000"
      : existing.tenant_id || "000000";
  const port =
    data.port !== undefined
      ? Number(data.port)
      : existing.port != null
        ? Number(existing.port)
        : 38881;
  const name =
    data.name !== undefined
      ? String(data.name || "").trim() || null
      : existing.name;
  const isActive =
    data.isActive !== undefined ? (data.isActive ? 1 : 0) : existing.is_active;

  if (!host) throw new Error("OLT host is required");
  if (!mac) throw new Error("OLT MAC is required");
  if (!username) throw new Error("OLT username is required");
  if (!String(password || "").trim()) throw new Error("OLT password is required");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("OLT port must be between 1 and 65535");
  }

  try {
    await query(
      `UPDATE pop_olts
       SET name = ?, host = ?, port = ?, mac = ?, username = ?, password = ?,
           tenant_id = ?, is_active = ?
       WHERE id = ?`,
      [name, host, port, mac, username, password, tenantId, isActive, id]
    );
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      throw new Error("An OLT with this MAC already exists on this POP");
    }
    throw err;
  }

  return getPopOltById(id);
}

async function updateBuildingOlt(id, data) {
  return updatePopOlt(id, data);
}

async function deletePopOlt(id) {
  const existing = await getPopOltById(id);
  if (!existing) throw new Error("OLT not found");
  await query(`DELETE FROM pop_olts WHERE id = ?`, [id]);
  return true;
}

async function deleteBuildingOlt(id) {
  return deletePopOlt(id);
}

async function listProducts(filters = {}) {
  const clauses = ["1=1"];
  const params = [];
  if (filters.buildingId) {
    clauses.push("p.building_id = ?");
    params.push(filters.buildingId);
  }
  if (filters.paymentFrequency) {
    clauses.push("p.payment_frequency = ?");
    params.push(filters.paymentFrequency);
  }
  if (filters.categoryId) {
    clauses.push("c.id = ?");
    params.push(filters.categoryId);
  }
  if (filters.planId) {
    clauses.push("pl.id = ?");
    params.push(filters.planId);
  }
  if (filters.activeOnly) {
    clauses.push("p.is_active = 1");
  }
  if (filters.search) {
    const q = `%${String(filters.search).trim()}%`;
    clauses.push("(p.name LIKE ? OR b.name LIKE ?)");
    params.push(q, q);
  }

  const unpaginated = filters.unpaginated === true || filters.unpaginated === "true";
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = unpaginated
    ? 1000
    : Math.min(100, Math.max(1, Number(filters.limit) || 25));
  const offset = unpaginated ? 0 : (page - 1) * limit;

  const { resolveListSort } = require("../utils/listSort");
  const sort = resolveListSort(filters, {
    allowed: [
      { key: "categoryName", sql: "c.name" },
      { key: "planName", sql: "COALESCE(pl.name, p.name)" },
      { key: "buildingName", sql: "b.name" },
      { key: "mbps", sql: "p.mbps" },
      { key: "extraBandwidth", sql: "p.extra_bandwidth" },
      { key: "price", sql: "p.price" },
      { key: "isActive", sql: "p.is_active" },
      { key: "paymentFrequency", sql: "p.payment_frequency" },
    ],
    defaultSort: { sortBy: "buildingName", sortDir: "asc" },
    defaultOrderClause:
      "c.sort_order, pl.sort_order, FIELD(p.payment_frequency, 'monthly', 'quarterly', 'yearly'), b.name",
  });

  const [countRow] = await query(
    `SELECT COUNT(*) AS total FROM products p
     JOIN buildings b ON b.id = p.building_id
     JOIN pops pop ON pop.id = b.pop_id
     LEFT JOIN package_plan_variants v ON v.id = p.plan_variant_id
     LEFT JOIN package_plans pl ON pl.id = v.plan_id
     LEFT JOIN package_categories c ON c.id = pl.category_id
     WHERE ${clauses.join(" AND ")}`,
    params
  );

  const rows = await query(
    `${PRODUCT_LIST_SELECT}
     WHERE ${clauses.join(" AND ")}
     ORDER BY ${sort.orderClause}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const products = rows;
  const total = Number(countRow.total);
  return {
    products,
    data: products,
    pagination: {
      page: unpaginated ? 1 : page,
      limit,
      total,
      pages: unpaginated ? 1 : Math.ceil(total / limit) || 1,
    },
  };
}

const PRODUCT_LIST_SELECT = `
  SELECT p.id, p.plan_variant_id AS planVariantId, p.name, p.mbps,
         p.extra_bandwidth AS extraBandwidth,
         p.payment_frequency AS paymentFrequency,
         p.has_dstv AS hasDstv, p.building_id AS buildingId, b.name AS buildingName,
         p.price, p.monthly_price AS monthlyPrice, p.is_active AS isActive,
         p.created_at AS createdAt,
         c.id AS categoryId, c.code AS categoryCode, c.name AS categoryName,
         pl.id AS planId, pl.code AS planCode, pl.name AS planName,
         pl.sort_order AS planSortOrder,
         c.requires_decoder_fee AS requiresDecoderFee,
         c.decoder_fee_amount AS decoderFeeAmount,
         pop.dstv_setup AS buildingDstvSetup
  FROM products p
  JOIN buildings b ON b.id = p.building_id
  JOIN pops pop ON pop.id = b.pop_id
  LEFT JOIN package_plan_variants v ON v.id = p.plan_variant_id
  LEFT JOIN package_plans pl ON pl.id = v.plan_id
  LEFT JOIN package_categories c ON c.id = pl.category_id`;

async function getProductListRow(id) {
  const rows = await query(`${PRODUCT_LIST_SELECT} WHERE p.id = ? LIMIT 1`, [
    id,
  ]);
  return rows[0] || null;
}

async function getProductById(id) {
  const rows = await query(
    `SELECT p.*, b.name AS building_name,
            pop.c2b_code, pop.b2b_code, pop.ip_setup,
            pl.id AS plan_id, pl.name AS plan_name, pl.sort_order AS plan_sort_order,
            c.code AS category_code, c.name AS category_name
     FROM products p
     JOIN buildings b ON b.id = p.building_id
     JOIN pops pop ON pop.id = b.pop_id
     LEFT JOIN package_plan_variants v ON v.id = p.plan_variant_id
     LEFT JOIN package_plans pl ON pl.id = v.plan_id
     LEFT JOIN package_categories c ON c.id = pl.category_id
     WHERE p.id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function assertUniquePriceInBuilding(buildingId, price, excludeProductId = null) {
  const params = [buildingId, Number(price)];
  let sql = `SELECT id
             FROM products
             WHERE building_id = ? AND price = ?`;
  if (excludeProductId != null) {
    sql += ` AND id <> ?`;
    params.push(Number(excludeProductId));
  }
  sql += ` LIMIT 1`;

  const rows = await query(sql, params);
  if (rows[0]) {
    throw new Error("Another package in this building already uses this price");
  }
}

async function createProduct(data) {
  const { planVariantId, buildingId, mbps, price, monthlyPrice, extraBandwidth } = data;

  if (!planVariantId || !buildingId || price == null) {
    throw new Error("Plan variant, building, and price are required");
  }

  const variant = await catalogStore.getPlanVariantDetails(planVariantId);
  if (!variant) throw new Error("Invalid plan variant");

  const building = await getBuildingById(buildingId);
  if (!building) throw new Error("Building not found");
  await assertUniquePriceInBuilding(buildingId, price);

  const dstvOnly = Boolean(variant.isDstvOnly);
  let resolvedMbps;
  let resolvedExtra = Math.max(0, Number(extraBandwidth) || 0);
  if (dstvOnly) {
    resolvedMbps = 0;
    resolvedExtra = 0;
  } else {
    resolvedMbps = mbps != null ? Number(mbps) : Number(variant.defaultMbps);
    if (!Number.isFinite(resolvedMbps) || resolvedMbps <= 0) {
      throw new Error("Bandwidth (Mbps) must be greater than 0");
    }
  }

  let monthly = monthlyPrice != null ? Number(monthlyPrice) : null;
  if (monthly == null) {
    monthly = await catalogStore.getMonthlyProductPriceForPlan(
      buildingId,
      variant.planId
    );
  }
  if (monthly == null) {
    if (variant.paymentFrequency === "monthly") {
      monthly = Number(price);
    } else if (variant.paymentFrequency === "quarterly") {
      monthly = Number(price) / 3;
    } else {
      monthly = Number(price) / 12;
    }
  }

  const result = await query(
    `INSERT INTO products (
       plan_variant_id, name, mbps, extra_bandwidth, payment_frequency, has_dstv,
       building_id, price, monthly_price
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      planVariantId,
      variant.displayName,
      resolvedMbps,
      resolvedExtra,
      variant.paymentFrequency,
      variant.hasDstv ? 1 : 0,
      buildingId,
      Number(price),
      monthly,
    ]
  );
  return result.insertId;
}

async function updateProduct(id, data) {
  const existing = await getProductById(id);
  if (!existing) throw new Error("Product not found");

  const fields = [];
  const params = [];

  let nextBuildingId = Number(existing.building_id);
  if (data.buildingId != null || data.building_id != null) {
    nextBuildingId = Number(data.buildingId ?? data.building_id);
    const building = await getBuildingById(nextBuildingId);
    if (!building) throw new Error("Building not found");
    fields.push("building_id = ?");
    params.push(nextBuildingId);
  }

  let nextMbps = Number(existing.mbps);
  let dstvOnly = catalogStore.isDstvOnlyCategory(existing.category_code);
  let resolvedVariant = null;
  if (data.planVariantId != null) {
    resolvedVariant = await catalogStore.getPlanVariantDetails(
      Number(data.planVariantId)
    );
    if (!resolvedVariant) throw new Error("Invalid plan variant");
    dstvOnly = Boolean(resolvedVariant.isDstvOnly);
    nextMbps = dstvOnly ? 0 : Number(resolvedVariant.defaultMbps);
    fields.push(
      "plan_variant_id = ?",
      "name = ?",
      "payment_frequency = ?",
      "has_dstv = ?"
    );
    params.push(
      resolvedVariant.id,
      resolvedVariant.displayName,
      resolvedVariant.paymentFrequency,
      resolvedVariant.hasDstv ? 1 : 0
    );
  }

  const allowed = {
    mbps: (v) => {
      const n = Number(v);
      if (dstvOnly) return 0;
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error("Bandwidth (Mbps) must be greater than 0");
      }
      return n;
    },
    price: (v) => Number(v),
    monthly_price: (v) => Number(v),
    extra_bandwidth: (v) => (dstvOnly ? 0 : Math.max(0, Number(v) || 0)),
    is_active: (v) => (v ? 1 : 0),
    name: (v) =>
      dstvOnly
        ? catalogStore.DSTV_ONLY_PRODUCT_NAME
        : String(v).trim(),
    payment_frequency: (v) => v,
    has_dstv: (v) => (v ? 1 : 0),
  };

  for (const [key, transform] of Object.entries(allowed)) {
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const src = data[camel] ?? data[key];
    if (src !== undefined) {
      const value = transform(src);
      if (key === "mbps") nextMbps = value;
      fields.push(`${key} = ?`);
      params.push(value);
    }
  }

  // Apply resolved Mbps once after plan-variant defaults so custom speed wins.
  if (data.planVariantId != null && data.mbps === undefined) {
    fields.push("mbps = ?");
    params.push(dstvOnly ? 0 : nextMbps);
  }

  if (dstvOnly) {
    // Force zero bandwidth + DSTV Only label even when only price/active changed.
    if (!fields.some((f) => f.startsWith("mbps"))) {
      fields.push("mbps = ?");
      params.push(0);
    }
    if (!fields.some((f) => f.startsWith("extra_bandwidth"))) {
      fields.push("extra_bandwidth = ?");
      params.push(0);
    }
    if (!fields.some((f) => f.startsWith("name"))) {
      fields.push("name = ?");
      params.push(catalogStore.DSTV_ONLY_PRODUCT_NAME);
    }
  }

  const nextPrice =
    data.price !== undefined ? Number(data.price) : Number(existing.price);
  await assertUniquePriceInBuilding(nextBuildingId, nextPrice, id);

  if (!fields.length) throw new Error("No changes to save");
  params.push(id);
  await query(`UPDATE products SET ${fields.join(", ")} WHERE id = ?`, params);
  return getProductListRow(id);
}

async function deleteProduct(id) {
  const existing = await getProductById(id);
  if (!existing) throw new Error("Product not found");

  const [customerCount] = await query(
    `SELECT COUNT(*) AS total FROM customers WHERE product_id = ?`,
    [id]
  );
  const linkedCustomers = Number(customerCount?.total || 0);
  if (linkedCustomers > 0) {
    throw new Error(
      `Cannot delete package — ${linkedCustomers} customer${
        linkedCustomers === 1 ? " is" : "s are"
      } still assigned to it. Reassign or deactivate them first, or mark the package inactive.`
    );
  }

  const [pendingCount] = await query(
    `SELECT COUNT(*) AS total FROM pending_upgrades
     WHERE target_product_id = ? AND status = 'payment_pending'`,
    [id]
  );
  const linkedPending = Number(pendingCount?.total || 0);
  if (linkedPending > 0) {
    throw new Error(
      `Cannot delete package — ${linkedPending} pending upgrade${
        linkedPending === 1 ? " is" : "s are"
      } targeting it`
    );
  }

  // Clear completed/failed upgrade rows that would block the FK.
  await query(`DELETE FROM pending_upgrades WHERE target_product_id = ?`, [id]);
  await query(
    `UPDATE customer_events
     SET old_product_id = NULL
     WHERE old_product_id = ?`,
    [id]
  );
  await query(
    `UPDATE customer_events
     SET new_product_id = NULL
     WHERE new_product_id = ?`,
    [id]
  );

  const result = await query(`DELETE FROM products WHERE id = ?`, [id]);
  if (!result.affectedRows) throw new Error("Product not found");
  return { id: Number(id) };
}

async function listAgencies(filters = {}) {
  const clauses = ["1=1"];
  const params = [];
  if (filters.search) {
    const q = `%${String(filters.search).trim()}%`;
    clauses.push("(a.name LIKE ? OR a.email LIKE ? OR a.contact_person LIKE ?)");
    params.push(q, q, q);
  }

  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
  const offset = (page - 1) * limit;

  const { resolveListSort } = require("../utils/listSort");
  const sort = resolveListSort(filters, {
    allowed: [
      { key: "name", sql: "a.name" },
      { key: "contactPerson", sql: "a.contact_person" },
      { key: "phone", sql: "a.phone" },
      { key: "email", sql: "a.email" },
      { key: "activeCustomers", sql: "activeCustomers" },
    ],
    defaultSort: { sortBy: "name", sortDir: "asc" },
  });

  const [countRow] = await query(
    `SELECT COUNT(*) AS total FROM agencies a WHERE ${clauses.join(" AND ")}`,
    params
  );

  const agencies = await query(
    `SELECT a.id, a.name, a.email, a.phone, a.contact_person AS contactPerson,
            a.discount_percent AS discountPercent,
            a.created_at AS createdAt,
            COUNT(DISTINCT CASE WHEN c.status = 'active' THEN c.id END) AS activeCustomers
     FROM agencies a
     LEFT JOIN customers c ON c.agency_id = a.id
     WHERE ${clauses.join(" AND ")}
     GROUP BY a.id, a.name, a.email, a.phone, a.contact_person, a.discount_percent, a.created_at
     ORDER BY ${sort.orderClause} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  for (const agency of agencies) {
    agency.activeCustomers = Number(agency.activeCustomers || 0);
    agency.discountPercent =
      agency.discountPercent != null ? Number(agency.discountPercent) : null;
  }

  return {
    agencies,
    data: agencies,
    pagination: {
      page,
      limit,
      total: Number(countRow.total),
      pages: Math.ceil(Number(countRow.total) / limit) || 1,
    },
  };
}

function normalizeAgencyDiscountPercentInput(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 100) throw new Error("Discount percent cannot exceed 100");
  return Math.round(n * 1000) / 1000;
}

async function getAgencyById(id) {
  const rows = await query(
    `SELECT id, name, email, phone, contact_person AS contactPerson,
            discount_percent AS discountPercent, created_at AS createdAt
     FROM agencies WHERE id = ? LIMIT 1`,
    [id]
  );
  const row = rows[0] || null;
  if (row) {
    row.discountPercent =
      row.discountPercent != null ? Number(row.discountPercent) : null;
  }
  return row;
}

async function createAgency(data) {
  const { name, email, phone, contactPerson, discountPercent } = data;
  const discount = normalizeAgencyDiscountPercentInput(discountPercent);
  const result = await query(
    `INSERT INTO agencies (name, email, phone, contact_person, discount_percent)
     VALUES (?, ?, ?, ?, ?)`,
    [
      String(name).trim(),
      String(email).trim().toLowerCase(),
      String(phone).trim(),
      contactPerson ? String(contactPerson).trim() : null,
      discount,
    ]
  );
  return result.insertId;
}

async function updateAgency(id, data) {
  const existing = await getAgencyById(id);
  if (!existing) throw new Error("Agency not found");

  const name = data.name !== undefined ? String(data.name).trim() : existing.name;
  const email =
    data.email !== undefined ? String(data.email).trim().toLowerCase() : existing.email;
  const phone = data.phone !== undefined ? String(data.phone).trim() : existing.phone;
  const contactPerson =
    data.contactPerson !== undefined
      ? data.contactPerson
        ? String(data.contactPerson).trim()
        : null
      : existing.contactPerson;
  const discountPercent =
    data.discountPercent !== undefined
      ? normalizeAgencyDiscountPercentInput(data.discountPercent)
      : existing.discountPercent;

  if (!name || !email || !phone) {
    throw new Error("Name, email, and phone are required");
  }

  await query(
    `UPDATE agencies
     SET name = ?, email = ?, phone = ?, contact_person = ?, discount_percent = ?
     WHERE id = ?`,
    [name, email, phone, contactPerson, discountPercent, id]
  );
}

async function listCustomersByAgency(agencyId) {
  const rows = await query(
    `${CUSTOMER_SELECT} WHERE c.agency_id = ? ORDER BY c.created_at DESC`,
    [agencyId]
  );
  return rows.map(mapCustomerRow);
}

async function listCustomers(filters = {}) {
  const { subscriptionStatusFilterClause } = require("../utils/subscriptionStatus");
  const clauses = ["1=1"];
  const params = [];
  if (filters.accountStatus) {
    clauses.push("c.status = ?");
    params.push(filters.accountStatus);
  }
  const subscriptionFilter = subscriptionStatusFilterClause(
    filters.subscriptionStatus
  );
  if (subscriptionFilter) {
    clauses.push(subscriptionFilter.sql);
    params.push(...subscriptionFilter.params);
  }
  if (filters.buildingId) {
    clauses.push("c.building_id = ?");
    params.push(filters.buildingId);
  }
  if (filters.categoryId) {
    clauses.push("cat.id = ?");
    params.push(filters.categoryId);
  }
  if (filters.customerType) {
    clauses.push("c.customer_type = ?");
    params.push(filters.customerType);
  }
  const premiseType = normalizePremiseType(filters.premiseType);
  if (filters.premiseType && (premiseType === "shop" || String(filters.premiseType).toLowerCase() === "apartment")) {
    clauses.push("c.premise_type = ?");
    params.push(premiseType);
  }
  const searchFilter = buildCustomerSearchFilter(filters.search, {
    mode: filters.searchMode === "exact" ? "exact" : "fuzzy",
  });
  if (searchFilter) {
    clauses.push(searchFilter.sql);
    params.push(...searchFilter.params);
  }
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = filters.forExport
    ? Math.min(10000, Math.max(1, Number(filters.limit) || 10000))
    : Math.min(100, Math.max(1, Number(filters.limit) || 25));
  const offset = (page - 1) * limit;

  const { resolveListSort } = require("../utils/listSort");
  const sort = resolveListSort(filters, {
    allowed: [
      { key: "customerType", sql: "c.customer_type" },
      { key: "customerName", sql: "c.last_name" },
      { key: "customerNumber", sql: "c.customer_number" },
      { key: "buildingName", sql: "b.name" },
      { key: "apartmentNumber", sql: "c.apartment_number" },
      { key: "productName", sql: "p.name" },
      { key: "paymentFrequency", sql: "c.payment_frequency" },
      { key: "subscriptionStatus", sql: "c.subscription_status" },
      { key: "tispDueDate", sql: "COALESCE(ts.due_date, '')" },
      { key: "lastPaymentDate", sql: LAST_PAYMENT_SORT_EXPR },
      { key: "packagePrice", sql: "c.package_price" },
    ],
    defaultSort: { sortBy: "customerName", sortDir: "asc" },
    defaultOrderClause: "c.created_at DESC",
  });

  const [countRow] = await query(
    filters.categoryId
      ? `SELECT COUNT(*) AS total
     FROM customers c
     JOIN products p ON p.id = c.product_id
     LEFT JOIN package_plan_variants v ON v.id = p.plan_variant_id
     LEFT JOIN package_plans pl ON pl.id = v.plan_id
     LEFT JOIN package_categories cat ON cat.id = pl.category_id
     WHERE ${clauses.join(" AND ")}`
      : `SELECT COUNT(*) AS total
     FROM customers c
     WHERE ${clauses.join(" AND ")}`,
    params
  );

  const rows = await query(
    `${CUSTOMER_SELECT} WHERE ${clauses.join(" AND ")}
     ORDER BY ${sort.orderClause} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    data: rows.map(mapCustomerRow),
    pagination: {
      page,
      limit,
      total: Number(countRow.total),
      pages: Math.ceil(Number(countRow.total) / limit) || 1,
    },
  };
}

async function getCustomerById(id) {
  const rows = await query(`${CUSTOMER_SELECT} WHERE c.id = ? LIMIT 1`, [id]);
  return mapCustomerRow(rows[0]);
}

async function getCustomerContext(id) {
  const rows = await query(
    `SELECT c.*, b.name AS building_name, b.building_code, b.pop_id,
            pop.name AS pop_name,
            pop.c2b_code, pop.b2b_code, pop.ip_setup, pop.dstv_setup,
            bo.id AS linked_building_olt_id,
            bo.name AS building_olt_name,
            bo.host AS building_olt_host, bo.port AS building_olt_port,
            bo.mac AS building_olt_mac,
            bo.username AS building_olt_username,
            bo.password AS building_olt_password,
            bo.tenant_id AS building_olt_tenant_id,
            p.name AS product_name, p.mbps AS product_mbps,
            p.extra_bandwidth AS product_extra_bandwidth,
            p.has_dstv AS product_has_dstv,
            p.plan_variant_id AS plan_variant_id,
            pl.id AS plan_id, pl.name AS plan_name, pl.sort_order AS plan_sort_order,
            cat.id AS category_id,
            cat.code AS category_code,
            cat.name AS category_name,
            a.name AS agency_name, a.email AS agency_email,
            a.phone AS agency_phone, a.contact_person AS agency_contact_person,
            ts.due_date AS tisp_due_date
     FROM customers c
     JOIN buildings b ON b.id = c.building_id
     JOIN pops pop ON pop.id = b.pop_id
     JOIN products p ON p.id = c.product_id
     LEFT JOIN pop_olts bo ON bo.id = c.building_olt_id
     LEFT JOIN agencies a ON a.id = c.agency_id
     LEFT JOIN package_plan_variants v ON v.id = p.plan_variant_id
     LEFT JOIN package_plans pl ON pl.id = v.plan_id
     LEFT JOIN package_categories cat ON cat.id = pl.category_id
     LEFT JOIN tisp_customer_snapshots ts ON ts.customer_id = c.id
     WHERE c.id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function updateCustomerSubscriptionStatus(id, status, lastPaymentDate = undefined) {
  if (lastPaymentDate === undefined) {
    await query(`UPDATE customers SET subscription_status = ? WHERE id = ?`, [
      status,
      id,
    ]);
    return;
  }

  await query(
    `UPDATE customers SET subscription_status = ?, last_payment_date = COALESCE(?, last_payment_date) WHERE id = ?`,
    [status, lastPaymentDate || null, id]
  );
}

async function recordCustomerLastPayment(customerNumber, paymentDate) {
  const ref = String(customerNumber || "").trim();
  if (!ref) return;

  const date =
    formatDateOnly(paymentDate) || new Date().toISOString().slice(0, 10);

  const resolved = await resolveCustomerByPaybillRef(ref);
  if (resolved?.id) {
    await query(
      `UPDATE customers
       SET last_payment_date = ?
       WHERE id = ?
         AND (last_payment_date IS NULL OR ? > last_payment_date)`,
      [date, resolved.id, date]
    );
    return;
  }

  await query(
    `UPDATE customers
     SET last_payment_date = ?
     WHERE UPPER(customer_number) = UPPER(?)
       AND (last_payment_date IS NULL OR ? > last_payment_date)`,
    [date, ref, date]
  );
}

/**
 * Zoho is the source of truth for last payment date — always overwrite the
 * dashboard value (even when Zoho is older than the local date).
 */
async function setCustomerLastPaymentFromZoho(customerNumber, paymentDate) {
  const ref = String(customerNumber || "").trim();
  if (!ref) return null;

  const date = formatDateOnly(paymentDate);
  if (!date) return null;

  await query(
    `UPDATE customers
     SET last_payment_date = ?
     WHERE UPPER(customer_number) = UPPER(?)`,
    [date, ref]
  );
  return date;
}

async function updateCustomerTispSync(id, syncStatus, syncError = null) {
  await query(
    `UPDATE customers SET tisp_sync_status = ?, tisp_sync_error = ? WHERE id = ?`,
    [syncStatus, sanitizeSyncError(syncError), id]
  );
}

/**
 * Clear stale TISP sync failures when the account is verified on TISP
 * (lookup snapshot or successful refresh).
 */
async function reconcileTispSyncStatus(customerId, hints = {}) {
  const customer = await getCustomerById(customerId);
  if (!customer) return customer;
  if (customer.tispSyncStatus === "synced") return customer;

  if (hints.verified === true) {
    await updateCustomerTispSync(customerId, "synced", null);
    return getCustomerById(customerId);
  }

  const rows = await query(
    `SELECT subscription_status
     FROM tisp_customer_snapshots
     WHERE customer_id = ?
     ORDER BY synced_at DESC
     LIMIT 1`,
    [customerId]
  );
  const snapStatus = String(rows[0]?.subscription_status || "").trim();
  const snapNormalized = snapStatus
    ? normalizeSubscriptionStatus(snapStatus)
    : "";
  if (snapNormalized && snapNormalized !== "Not on TISP") {
    await updateCustomerTispSync(customerId, "synced", null);
    return getCustomerById(customerId);
  }

  const sub = String(customer.subscriptionStatus || "").trim();
  const subNormalized = normalizeSubscriptionStatus(sub);
  if (
    customer.tispSyncStatus === "failed" &&
    subNormalized &&
    subNormalized !== "Not on TISP"
  ) {
    await updateCustomerTispSync(customerId, "synced", null);
    return getCustomerById(customerId);
  }

  return customer;
}

async function updateCustomerZohoBillingStatus(id, billingStatus, billingError = null) {
  await query(
    `UPDATE customers SET zoho_billing_status = ?, zoho_billing_error = ? WHERE id = ?`,
    [billingStatus, billingError, id]
  );
}

/**
 * Mark billing setup complete when Zoho contact + invoices already exist
 * (e.g. imported customers or onboarding finished before status was persisted).
 */
async function reconcileZohoBillingStatus(customerId, hints = {}) {
  const customer = await getCustomerById(customerId);
  if (!customer || customer.zohoBillingStatus === "completed") {
    return customer;
  }
  if (customer.zohoBillingStatus === "failed") {
    return customer;
  }

  const linked = Boolean(hints.linked);
  const invoiceCount = Number(hints.invoiceCount || 0);

  if (linked && invoiceCount > 0) {
    await updateCustomerZohoBillingStatus(customerId, "completed", null);
    return getCustomerById(customerId);
  }

  const rows = await query(
    `SELECT
       (SELECT COUNT(*) FROM zoho_customer_contacts WHERE customer_id = ?) AS contacts,
       (SELECT COUNT(*) FROM zoho_customer_invoices WHERE customer_id = ?) AS invoices,
       (SELECT COUNT(*) FROM zoho_recurring_invoices WHERE customer_id = ?) AS recurring`,
    [customerId, customerId, customerId]
  );
  const snap = rows[0] || {};
  const hasContact = Number(snap.contacts || 0) > 0;
  const hasBillingArtifact =
    Number(snap.invoices || 0) > 0 || Number(snap.recurring || 0) > 0;

  if (hasContact && hasBillingArtifact) {
    await updateCustomerZohoBillingStatus(customerId, "completed", null);
    return getCustomerById(customerId);
  }

  return customer;
}

async function allocateZohoInvoiceSequence(customerId, invoicePrefix = null) {
  if (invoicePrefix) {
    const [customer] = await query(
      `SELECT zoho_invoice_seq FROM customers WHERE id = ?`,
      [customerId]
    );
    if (!customer) {
      throw new Error("Customer not found");
    }
    if (Number(customer.zoho_invoice_seq) === 0) {
      const rows = await query(
        `SELECT invoice_number FROM zoho_customer_invoices
         WHERE customer_id = ? AND invoice_number LIKE ?`,
        [customerId, `${invoicePrefix}INV%`]
      );
      let maxSeq = 0;
      const escaped = String(invoicePrefix).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`^${escaped}INV(\\d+)$`, "i");
      for (const row of rows) {
        const match = String(row.invoice_number || "").match(pattern);
        if (match) {
          maxSeq = Math.max(maxSeq, Number(match[1]));
        }
      }
      if (maxSeq > 0) {
        await query(
          `UPDATE customers SET zoho_invoice_seq = ? WHERE id = ? AND zoho_invoice_seq = 0`,
          [maxSeq, customerId]
        );
      }
    }
  }

  await query(
    `UPDATE customers SET zoho_invoice_seq = LAST_INSERT_ID(zoho_invoice_seq + 1) WHERE id = ?`,
    [customerId]
  );
  const [row] = await query(`SELECT LAST_INSERT_ID() AS seq`);
  const seq = Number(row?.seq);
  if (!seq) {
    throw new Error("Failed to allocate Zoho invoice sequence");
  }
  return seq;
}

async function recordSignupInvoiceDelivery(customerId, invoiceId, { emailed = false } = {}) {
  const emailedAt = emailed ? new Date() : null;
  await query(
    `UPDATE customers
     SET zoho_signup_invoice_id = ?,
         zoho_signup_invoice_emailed_at = CASE
           WHEN ? IS NOT NULL THEN COALESCE(zoho_signup_invoice_emailed_at, ?)
           ELSE zoho_signup_invoice_emailed_at
         END
     WHERE id = ?`,
    [String(invoiceId), emailedAt, emailedAt, customerId]
  );
}

async function findActiveTenantInApartment(
  buildingId,
  apartmentNumber,
  excludeCustomerId = null
) {
  const apt = String(apartmentNumber || "").trim().toUpperCase();
  if (!apt) return null;

  const params = [buildingId, apt];
  let sql = `SELECT id, customer_number, first_name, middle_name, last_name,
                    apartment_number, status
             FROM customers
             WHERE building_id = ? AND apartment_number = ? AND status = 'active'`;
  if (excludeCustomerId) {
    sql += " AND id != ?";
    params.push(excludeCustomerId);
  }
  sql += " LIMIT 1";

  const rows = await query(sql, params);
  return rows[0] || null;
}

async function assertApartmentAvailable(
  buildingId,
  apartmentNumber,
  excludeCustomerId = null
) {
  const tenant = await findActiveTenantInApartment(
    buildingId,
    apartmentNumber,
    excludeCustomerId
  );
  if (!tenant) return;

  const tenantName = [tenant.first_name, tenant.middle_name, tenant.last_name]
    .filter(Boolean)
    .join(" ");
  throw new Error(
    `Apartment ${tenant.apartment_number} already has an active tenant: ${tenantName} (${tenant.customer_number})`
  );
}

async function apartmentHasHistory(buildingId, apartmentNumber) {
  const rows = await query(
    `SELECT id FROM apartment_history
     WHERE building_id = ? AND apartment_number = ?
     LIMIT 1`,
    [buildingId, String(apartmentNumber || "").trim().toUpperCase()]
  );
  return rows.length > 0;
}

/**
 * Last known static IP for an apartment (from prior/current occupants).
 */
async function findLastIpForApartment(
  buildingId,
  apartmentNumber,
  excludeCustomerId = null
) {
  const apt = String(apartmentNumber || "").trim().toUpperCase();
  const params = [buildingId, apt];
  let excludeSql = "";
  if (excludeCustomerId) {
    excludeSql = " AND c.id <> ?";
    params.push(Number(excludeCustomerId));
  }
  const rows = await query(
    `SELECT COALESCE(
              NULLIF(TRIM(h.ip_address), ''),
              NULLIF(TRIM(c.ip_address), '')
            ) AS ipAddress
     FROM apartment_history h
     INNER JOIN customers c ON c.id = h.customer_id
     WHERE h.building_id = ?
       AND h.apartment_number = ?
       AND (
         (h.ip_address IS NOT NULL AND TRIM(h.ip_address) <> '')
         OR (c.ip_address IS NOT NULL AND TRIM(c.ip_address) <> '')
       )
       ${excludeSql}
     ORDER BY COALESCE(h.moved_out_at, h.moved_in_at) DESC, h.id DESC
     LIMIT 1`,
    params
  );
  const ip = rows[0]?.ipAddress ? String(rows[0].ipAddress).trim() : "";
  return ip || null;
}

async function inspectApartmentForMove(
  buildingId,
  apartmentNumber,
  excludeCustomerId = null
) {
  const apt = String(apartmentNumber || "").trim().toUpperCase();
  const building = await getBuildingById(buildingId);
  if (!building) throw new Error("Building not found");

  const tenant = await findActiveTenantInApartment(
    buildingId,
    apt,
    excludeCustomerId
  );
  const apartmentKnown = await apartmentHasHistory(buildingId, apt);
  const lastIp = await findLastIpForApartment(
    buildingId,
    apt,
    excludeCustomerId
  );

  let lastIpAvailable = false;
  if (lastIp) {
    const holder = await findCustomerByIp(lastIp);
    lastIpAvailable =
      !holder ||
      (excludeCustomerId != null && Number(holder.id) === Number(excludeCustomerId));
  }

  const ipSetup = String(building.ip_setup || "").toUpperCase();
  const needsIpInput =
    ipSetup === "STATIC" && !(apartmentKnown && lastIp && lastIpAvailable);

  return {
    available: !tenant,
    apartmentKnown,
    lastIp: lastIpAvailable ? lastIp : null,
    needsIpInput,
    ipSetup,
    tenant: tenant
      ? {
          id: tenant.id,
          customerNumber: tenant.customer_number,
          customerName: [tenant.first_name, tenant.middle_name, tenant.last_name]
            .filter(Boolean)
            .join(" "),
          apartmentNumber: tenant.apartment_number,
        }
      : null,
  };
}

function normalizeDstvDecoderSerial(value) {
  const serial = String(value || "").trim().toUpperCase();
  return serial || null;
}

function assertDstvDecoderSerial(product, building, serial) {
  if (!product?.has_dstv) return;
  const setup = building?.dstv_setup || "decoder";
  if (setup !== "decoder") return;
  const normalized = normalizeDstvDecoderSerial(serial);
  if (!normalized) {
    throw new Error(
      "DSTV decoder IUC/Serial number is required for DSTV packages in decoder buildings"
    );
  }
  if (normalized.length < 4 || normalized.length > 50) {
    throw new Error("DSTV decoder serial must be between 4 and 50 characters");
  }
}

async function findCustomerByDstvSerial(serial) {
  const normalized = normalizeDstvDecoderSerial(serial);
  if (!normalized) return null;
  const rows = await query(
    `SELECT id, customer_number, first_name, middle_name, last_name, status
     FROM customers WHERE dstv_decoder_serial = ? LIMIT 1`,
    [normalized]
  );
  return rows[0] || null;
}

async function assertDstvSerialUnique(serial, excludeCustomerId = null) {
  const normalized = normalizeDstvDecoderSerial(serial);
  if (!normalized) return;

  await releaseCancelledIdentityForReuse({
    dstvDecoderSerial: normalized,
    excludeCustomerId,
  });
}

async function validateAndNormalizeCustomerEmail(data, { existingCustomer = null } = {}) {
  const customerType = String(
    data.customerType || existingCustomer?.customerType || ""
  )
    .trim()
    .toUpperCase();
  const raw =
    data.email != null && data.email !== ""
      ? String(data.email).trim().toLowerCase()
      : "";

  if (raw) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      throw new Error("Enter a valid email address");
    }
    return raw;
  }

  if (customerType === "B2B") {
    const agencyId = data.agencyId ?? existingCustomer?.agencyId;
    if (!agencyId) {
      throw new Error("B2B customers must be linked to an agency");
    }
    const agency = await getAgencyById(Number(agencyId));
    const agencyEmail = agency?.email
      ? String(agency.email).trim().toLowerCase()
      : "";
    if (agencyEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(agencyEmail)) {
      return "";
    }
    throw new Error(
      "Email is required — enter a customer email or set the agency email address"
    );
  }

  throw new Error("Email is required");
}

async function validateAndNormalizeCustomerPhone(data, { existingCustomer = null } = {}) {
  const customerType = String(
    data.customerType || existingCustomer?.customerType || ""
  )
    .trim()
    .toUpperCase();
  const raw =
    data.phone != null && data.phone !== "" ? String(data.phone).trim() : "";

  if (String(raw).replace(/\D/g, "").length >= 9) {
    return raw;
  }

  if (customerType === "B2B") {
    const agencyId = data.agencyId ?? existingCustomer?.agencyId;
    if (!agencyId) {
      throw new Error("B2B customers must be linked to an agency");
    }
    const agency = await getAgencyById(Number(agencyId));
    const agencyPhone = agency?.phone ? String(agency.phone).trim() : "";
    if (String(agencyPhone).replace(/\D/g, "").length >= 9) {
      return "";
    }
    throw new Error(
      "Phone is required — enter a customer phone or set the agency phone number"
    );
  }

  throw new Error("Phone is required");
}

async function createCustomer(data) {
  const building = await getBuildingById(data.buildingId);
  if (!building) throw new Error("Building not found");
  if (!String(building.name || "").trim()) {
    throw new Error("Selected building has no name configured");
  }

  const product = await getProductById(data.productId);
  if (!product) throw new Error("Product not found");
  if (product.building_id !== building.id) {
    throw new Error("Product does not belong to the selected building");
  }

  if (data.customerType === "B2B" && !data.agencyId) {
    throw new Error("B2B customers must be linked to an agency");
  }

  const names = data.firstName
    ? {
        first_name: String(data.firstName).trim(),
        middle_name: data.middleName ? String(data.middleName).trim() : null,
        last_name: String(data.lastName || "").trim(),
      }
    : splitFullName(data.fullName);

  if (!names.first_name || !names.last_name) {
    throw new Error("First name and last name are required");
  }

  const email = await validateAndNormalizeCustomerEmail(data);
  const phone = await validateAndNormalizeCustomerPhone(data);

  const ipCheck = validateIpForBuilding(building, data.ipAddress);
  if (!ipCheck.ok) {
    throw new Error(ipCheck.error);
  }
  const resolvedIp = ipCheck.ip;

  const premiseType = normalizePremiseType(data.premiseType);
  const businessName =
    premiseType === "shop" ? String(data.businessName || "").trim() : "";
  const shopLocation =
    premiseType === "shop" ? String(data.shopLocation || "").trim() : "";
  if (premiseType === "shop") {
    if (!businessName) throw new Error("Business name is required for a shop");
    if (!shopLocation) throw new Error("Shop location is required");
  }

  let apartmentNumber = String(data.apartmentNumber || "")
    .trim()
    .toUpperCase();
  if (premiseType === "shop") {
    apartmentNumber = shopLocationCode(shopLocation);
    if (!apartmentNumber) {
      throw new Error("Shop location must include letters or numbers");
    }
  }
  if (!apartmentNumber) {
    throw new Error(
      premiseType === "shop"
        ? "Could not assign a shop customer number"
        : "Apartment number is required"
    );
  }
  await assertApartmentAvailable(building.id, apartmentNumber);

  const customerNumber = buildCustomerNumber(
    building,
    data.customerType,
    apartmentNumber,
    premiseType
  );

  const dstvDecoderSerial = normalizeDstvDecoderSerial(data.dstvDecoderSerial);
  assertDstvDecoderSerial(product, building, dstvDecoderSerial);

  // Cancelled prior tenants still hold UNIQUE keys — free them for the new occupant.
  await releaseCancelledIdentityForReuse({
    customerNumber,
    ipAddress: resolvedIp,
    dstvDecoderSerial,
  });

  const tispPassword =
    building.ip_setup === "STATIC"
      ? apartmentNumber
      : normalizePppoePassword(
          data.ppoePassword || data.tispPassword,
          { required: false }
        ) || generatePppoePassword();

  const ppoeUsername =
    building.ip_setup === "PPOE"
      ? normalizePppoeUsername(
          data.ppoeUsername,
          customerNumber
        )
      : null;
  if (building.ip_setup === "PPOE" && !ppoeUsername) {
    throw new Error("PPPoE username is required");
  }

  const packagePrice = resolvePackagePrice(
    product,
    data.paymentFrequency,
    data.customPeriodDays ?? data.customPeriodMonths
  );

  let decoderFeeRequired = 0;
  let decoderFeeAmount = null;
  const decoderFee = await resolveDecoderFeeForProduct(product, building);
  decoderFeeRequired = decoderFee.required;
  decoderFeeAmount = decoderFee.amount;

  const freqForProduct =
    data.paymentFrequency === "custom" ? "monthly" : data.paymentFrequency;
  if (product.payment_frequency !== freqForProduct && data.paymentFrequency !== "custom") {
    throw new Error("Selected product does not match payment frequency");
  }

  const trialPeriodEnabled = Boolean(data.trialPeriod);
  const trialEndsAt = trialPeriodEnabled ? computeTrialEndDate() : null;

  const trimOrNull = (v) => {
    const s = v == null ? "" : String(v).trim();
    return s || null;
  };
  const { buildingToBillingAddress, isBillingAddressEmpty } = require("../utils/buildingBillingAddress");
  let billingAttention = trimOrNull(data.billingAttention);
  let billingAddress = trimOrNull(data.billingAddress);
  let billingStreet2 = trimOrNull(data.billingStreet2);
  let billingCity = trimOrNull(data.billingCity);
  let billingState = trimOrNull(data.billingState);
  let billingZip = trimOrNull(data.billingZip);
  let billingCountry = trimOrNull(data.billingCountry);
  let hasBilling = !isBillingAddressEmpty({
    billingAttention,
    billingAddress,
    billingStreet2,
    billingCity,
    billingState,
    billingZip,
    billingCountry,
  });
  if (!hasBilling) {
    const fromBuilding = buildingToBillingAddress(building);
    if (fromBuilding) {
      billingAttention = fromBuilding.billingAttention;
      billingAddress = fromBuilding.billingAddress;
      billingStreet2 = fromBuilding.billingStreet2;
      billingCity = fromBuilding.billingCity;
      billingState = fromBuilding.billingState;
      billingZip = fromBuilding.billingZip;
      billingCountry = fromBuilding.billingCountry;
      hasBilling = true;
    }
  }
  billingCountry = hasBilling ? billingCountry || "Kenya" : null;

  const result = await query(
    `INSERT INTO customers (
       first_name, middle_name, last_name, phone, email,
       billing_attention, billing_address, billing_street2, billing_city,
       billing_state, billing_zip, billing_country,
       ip_address,
       is_vat_exempt, customer_type, premise_type, apartment_number,
       business_name, shop_location, payment_frequency,
       custom_period_days, building_id, product_id, agency_id,
       customer_number, tisp_password, ppoe_username, package_price,
       decoder_fee_amount, decoder_fee_required, dstv_decoder_serial,
       trial_period_enabled, trial_ends_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      names.first_name,
      names.middle_name,
      names.last_name,
      String(phone),
      email,
      billingAttention,
      billingAddress,
      billingStreet2,
      billingCity,
      billingState,
      billingZip,
      billingCountry,
      resolvedIp,
      data.isVatExempt ? 1 : 0,
      data.customerType,
      premiseType,
      apartmentNumber,
      premiseType === "shop" ? businessName : null,
      premiseType === "shop" ? shopLocation : null,
      data.paymentFrequency,
      data.paymentFrequency === "custom"
        ? Number(data.customPeriodDays ?? data.customPeriodMonths)
        : null,
      building.id,
      product.id,
      data.agencyId || null,
      customerNumber,
      tispPassword,
      ppoeUsername,
      packagePrice,
      decoderFeeAmount,
      decoderFeeRequired,
      dstvDecoderSerial,
      trialPeriodEnabled ? 1 : 0,
      trialEndsAt,
    ]
  );

  const customerId = result.insertId;
  const customerName = [names.first_name, names.middle_name, names.last_name]
    .filter(Boolean)
    .join(" ");

  await query(
    `INSERT INTO apartment_history
       (building_id, apartment_number, customer_id, customer_number, customer_name, ip_address, reason)
     VALUES (?, ?, ?, ?, ?, ?, 'signup')`,
    [
      building.id,
      apartmentNumber,
      customerId,
      customerNumber,
      customerName,
      resolvedIp || null,
    ]
  );

  await query(
    `INSERT INTO customer_events (customer_id, event_type, new_product_id, new_apartment, notes)
     VALUES (?, 'created', ?, ?, ?)`,
    [
      customerId,
      product.id,
      apartmentNumber,
      trialPeriodEnabled
        ? "Customer signed up with 30-day trial"
        : "Customer signed up",
    ]
  );

  return {
    customerId,
    customerNumber,
    building,
    product,
    names,
    apartmentNumber,
    premiseType,
    businessName: premiseType === "shop" ? businessName : null,
    shopLocation: premiseType === "shop" ? shopLocation : null,
    tispPassword,
    packagePrice,
    decoderFeeAmount,
    decoderFeeRequired: Boolean(decoderFeeRequired),
    customerName,
    trialPeriodEnabled,
    trialEndsAt,
  };
}

async function changeCustomerProduct(customerId, newProductId, eventType) {
  const customer = await getCustomerContext(customerId);
  if (!customer) throw new Error("Customer not found");
  if (customer.status !== "active") {
    throw new Error("Cannot change package for inactive customer");
  }

  const newProduct = await getProductById(newProductId);
  if (!newProduct) throw new Error("Product not found");
  if (newProduct.building_id !== customer.building_id) {
    throw new Error("New product must belong to the same building");
  }

  const packagePrice = resolvePackagePrice(
    newProduct,
    customer.payment_frequency,
    customer.custom_period_days
  );

  const addingDstv =
    !Boolean(customer.product_has_dstv) && Boolean(newProduct.has_dstv);
  const { buildingUsesDecoder } = require("../utils/dstvSetup");
  let decoderFeeSql = "product_id = ?, package_price = ?";
  const decoderParams = [newProductId, packagePrice];
  if (addingDstv && buildingUsesDecoder(customer)) {
    let feeAmount = Number(process.env.ZOHO_DSTV_ONE_TIME_FEE || 2900);
    if (newProduct.plan_variant_id) {
      const variant = await catalogStore.getPlanVariantDetails(
        newProduct.plan_variant_id
      );
      if (variant?.decoderFeeAmount != null) {
        feeAmount = Number(variant.decoderFeeAmount);
      }
    }
    decoderFeeSql =
      "product_id = ?, package_price = ?, decoder_fee_required = 1, decoder_fee_amount = ?";
    decoderParams.push(feeAmount);
  }

  await query(
    `UPDATE customers SET ${decoderFeeSql} WHERE id = ?`,
    [...decoderParams, customerId]
  );

  await query(
    `INSERT INTO customer_events (customer_id, event_type, old_product_id, new_product_id, notes)
     VALUES (?, ?, ?, ?, ?)`,
    [
      customerId,
      eventType,
      customer.product_id,
      newProductId,
      `Package ${eventType}`,
    ]
  );

  return { customer, newProduct, packagePrice };
}

async function updateCustomerBillingCycle(
  customerId,
  paymentFrequency,
  customPeriodDays
) {
  const customer = await getCustomerContext(customerId);
  if (!customer) throw new Error("Customer not found");
  if (!["monthly", "quarterly", "yearly", "custom"].includes(paymentFrequency)) {
    throw new Error("Invalid payment frequency");
  }

  let days = null;
  if (paymentFrequency === "custom") {
    days = Number(customPeriodDays);
    if (!days || days < 1) {
      throw new Error("Custom period must be at least 1 day");
    }
  }

  const product = await getProductById(customer.product_id);
  if (!product) throw new Error("Product not found");

  const packagePrice = resolvePackagePrice(product, paymentFrequency, days);
  await query(
    `UPDATE customers SET payment_frequency = ?, custom_period_days = ?, package_price = ? WHERE id = ?`,
    [paymentFrequency, days, packagePrice, customerId]
  );
}

async function findProductForBillingFrequency(customer, paymentFrequency) {
  const freqForProduct =
    paymentFrequency === "custom" ? "monthly" : paymentFrequency;
  const currentProduct = await getProductById(customer.product_id);
  if (!currentProduct) throw new Error("Product not found");

  if (currentProduct.plan_variant_id) {
    const byPlan = await query(
      `SELECT p.*
       FROM products p
       JOIN package_plan_variants v ON v.id = p.plan_variant_id
       JOIN package_plan_variants cur ON cur.plan_id = v.plan_id
       WHERE p.building_id = ?
         AND cur.id = ?
         AND p.payment_frequency = ?
         AND p.is_active = 1
       ORDER BY (p.has_dstv = ?) DESC, p.id
       LIMIT 1`,
      [
        customer.building_id,
        currentProduct.plan_variant_id,
        freqForProduct,
        currentProduct.has_dstv ? 1 : 0,
      ]
    );
    if (byPlan[0]) return byPlan[0];
  }

  const byMbps = await query(
    `SELECT p.*
     FROM products p
     WHERE p.building_id = ?
       AND p.mbps = ?
       AND p.payment_frequency = ?
       AND p.is_active = 1
     ORDER BY (p.has_dstv = ?) DESC, p.name = ? DESC, p.id
     LIMIT 1`,
    [
      customer.building_id,
      currentProduct.mbps,
      freqForProduct,
      currentProduct.has_dstv ? 1 : 0,
      currentProduct.name,
    ]
  );
  if (!byMbps[0]) {
    throw new Error(
      `No ${freqForProduct} package found for ${currentProduct.mbps} Mbps in this building`
    );
  }
  return byMbps[0];
}

async function changeCustomerPaymentFrequency(
  customerId,
  paymentFrequency,
  customPeriodDays
) {
  const customer = await getCustomerContext(customerId);
  if (!customer) throw new Error("Customer not found");
  if (customer.status !== "active") {
    throw new Error("Cannot change billing for inactive customer");
  }
  if (!["monthly", "quarterly", "yearly", "custom"].includes(paymentFrequency)) {
    throw new Error("Invalid payment frequency");
  }

  let days = null;
  if (paymentFrequency === "custom") {
    days = Number(customPeriodDays);
    if (!days || days < 1) {
      throw new Error("Custom period must be at least 1 day");
    }
  }

  const currentFrequency = customer.payment_frequency;
  const currentDays = customer.custom_period_days;
  if (
    paymentFrequency === currentFrequency &&
    (paymentFrequency !== "custom" || days === currentDays)
  ) {
    throw new Error("Customer is already on this payment frequency");
  }

  const newProduct = await findProductForBillingFrequency(
    customer,
    paymentFrequency
  );
  const packagePrice = resolvePackagePrice(newProduct, paymentFrequency, days);

  await query(
    `UPDATE customers
     SET product_id = ?, payment_frequency = ?, custom_period_days = ?, package_price = ?
     WHERE id = ?`,
    [newProduct.id, paymentFrequency, days, packagePrice, customerId]
  );

  await query(
    `INSERT INTO customer_events (customer_id, event_type, old_product_id, new_product_id, notes)
     VALUES (?, 'upgrade', ?, ?, ?)`,
    [
      customerId,
      customer.product_id,
      newProduct.id,
      `Payment frequency: ${currentFrequency}${
        currentFrequency === "custom" && currentDays
          ? ` (${currentDays} days)`
          : ""
      } → ${paymentFrequency}${
        paymentFrequency === "custom" && days ? ` (${days} days)` : ""
      }`,
    ]
  );

  return {
    customer,
    newProduct,
    packagePrice,
    previousFrequency: currentFrequency,
    previousCustomPeriodDays: currentDays,
  };
}

async function switchCustomerApartment(
  customerId,
  newApartmentRaw,
  options = {}
) {
  const customer = await getCustomerContext(customerId);
  if (!customer) throw new Error("Customer not found");
  if (customer.status !== "active") {
    throw new Error("Cannot switch apartment for inactive customer");
  }

  const building = await getBuildingById(customer.building_id);
  const newApartment = String(newApartmentRaw).trim().toUpperCase();
  const oldApartment = customer.apartment_number;

  if (newApartment === oldApartment) {
    throw new Error("Customer is already in this apartment");
  }

  await assertApartmentAvailable(building.id, newApartment, customerId);

  const inspection = await inspectApartmentForMove(
    building.id,
    newApartment,
    customerId
  );

  let resolvedIp = customer.ip_address || null;
  if (String(building.ip_setup || "").toUpperCase() === "PPOE") {
    resolvedIp = null;
  } else {
    const providedIp =
      options.ipAddress != null && String(options.ipAddress).trim() !== ""
        ? String(options.ipAddress).trim()
        : null;
    const candidateIp = providedIp || inspection.lastIp || null;
    const ipCheck = validateIpForBuilding(building, candidateIp);
    if (!ipCheck.ok) {
      throw new Error(ipCheck.error);
    }
    if (!ipCheck.ip) {
      throw new Error(
        "IP address is required for this apartment — select an IP for the new apartment"
      );
    }
    if (ipCheck.ip !== customer.ip_address) {
      await releaseCancelledIdentityForReuse({
        ipAddress: ipCheck.ip,
        excludeCustomerId: customerId,
      });
    }
    resolvedIp = ipCheck.ip;
  }

  const newCustomerNumber = buildCustomerNumber(
    building,
    customer.customer_type,
    newApartment,
    customer.premise_type
  );
  const previousCustomerNumber = customer.customer_number;

  await releaseCancelledIdentityForReuse({
    customerNumber: newCustomerNumber,
    excludeCustomerId: customerId,
  });

  const tispPassword =
    building.ip_setup === "STATIC" ? newApartment : generatePppoePassword();

  const previousIp = customer.ip_address || null;
  const previousPpoeUsername = String(customer.ppoe_username || "").trim().toUpperCase();
  const ppoeUsername =
    String(building.ip_setup || "").toUpperCase() === "PPOE"
      ? !previousPpoeUsername ||
        previousPpoeUsername === String(previousCustomerNumber || "").toUpperCase()
        ? newCustomerNumber
        : previousPpoeUsername
      : null;

  await query(
    `UPDATE apartment_history
     SET moved_out_at = NOW(),
         reason = 'switch_out',
         ip_address = COALESCE(NULLIF(TRIM(ip_address), ''), ?)
     WHERE customer_id = ? AND moved_out_at IS NULL`,
    [previousIp, customerId]
  );

  const customerName = [customer.first_name, customer.middle_name, customer.last_name]
    .filter(Boolean)
    .join(" ");

  await query(
    `INSERT INTO apartment_history
       (building_id, apartment_number, customer_id, customer_number, customer_name, ip_address, reason)
     VALUES (?, ?, ?, ?, ?, ?, 'switch_in')`,
    [
      building.id,
      newApartment,
      customerId,
      newCustomerNumber,
      customerName,
      resolvedIp || null,
    ]
  );

  await query(
    `UPDATE customers
     SET apartment_number = ?, customer_number = ?, tisp_password = ?,
         ppoe_username = ?, ip_address = ?
     WHERE id = ?`,
    [
      newApartment,
      newCustomerNumber,
      tispPassword,
      ppoeUsername,
      resolvedIp,
      customerId,
    ]
  );

  await query(
    `INSERT INTO customer_events (customer_id, event_type, old_apartment, new_apartment, notes)
     VALUES (?, 'switch_apartment', ?, ?, ?)`,
    [
      customerId,
      oldApartment,
      newApartment,
      resolvedIp
        ? `Apartment switched within building (IP ${resolvedIp})`
        : "Apartment switched within building",
    ]
  );

  const updated = await getCustomerContext(customerId);
  return {
    customer: updated,
    building,
    oldApartment,
    newApartment,
    ipAddress: resolvedIp,
    tispPassword,
    previousCustomerNumber,
  };
}

async function cancelCustomer(customerId, payload = {}) {
  const normalized =
    typeof payload === "string" ? { notes: payload, reason: payload } : payload || {};
  const reason = String(normalized.reason || normalized.notes || "").trim();
  if (!reason) {
    throw new Error("Cancellation reason is required");
  }

  const customer = await getCustomerContext(customerId);
  if (!customer) throw new Error("Customer not found");
  if (customer.status === "cancelled") {
    throw new Error("Customer is already cancelled");
  }

  const onuCollectedAt = parseCancellationDate(
    normalized.onuCollectedAt,
    "ONU collected date"
  );
  if (!onuCollectedAt) {
    throw new Error("ONU collected date is required");
  }

  const needsDstvDecoder =
    Boolean(customer.product_has_dstv) &&
    String(customer.dstv_setup || "decoder") === "decoder";
  let dstvDecoderCollectedAt = null;
  if (needsDstvDecoder) {
    dstvDecoderCollectedAt = parseCancellationDate(
      normalized.dstvDecoderCollectedAt,
      "DSTV decoder collected date"
    );
    if (!dstvDecoderCollectedAt) {
      throw new Error(
        "DSTV decoder collected date is required for DSTV decoder packages"
      );
    }
  }

  await query(
    `UPDATE customers
     SET status = 'cancelled',
         subscription_status = 'Cancelled',
         cancellation_reason = ?,
         onu_collected_at = ?,
         dstv_decoder_collected_at = ?
     WHERE id = ?`,
    [reason, onuCollectedAt, dstvDecoderCollectedAt, customerId]
  );

  await query(
    `UPDATE apartment_history
     SET moved_out_at = NOW(),
         reason = 'cancel',
         ip_address = COALESCE(NULLIF(TRIM(ip_address), ''), ?),
         onu_collected_at = ?,
         dstv_decoder_collected_at = ?
     WHERE customer_id = ? AND moved_out_at IS NULL`,
    [
      customer.ip_address || null,
      onuCollectedAt,
      dstvDecoderCollectedAt,
      customerId,
    ]
  );

  const eventNotes = buildCancellationEventNotes({
    reason,
    onuCollectedAt,
    dstvDecoderCollectedAt,
  });

  await query(
    `INSERT INTO customer_events (customer_id, event_type, old_apartment, notes)
     VALUES (?, 'cancel', ?, ?)`,
    [customerId, customer.apartment_number, eventNotes]
  );

  // Eager identity release — apartment number / IP / DSTV free for next tenant.
  // Integrations still use the live number via liveCustomerNumber().
  await archiveCancelledCustomerIdentity(customerId, {
    customerNumber: customer.customer_number,
  });

  return customer;
}

function parseCancellationDate(value, label) {
  if (value == null || value === "") return null;
  const raw = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`${label} must be a valid date (YYYY-MM-DD)`);
  }
  return raw;
}

function buildCancellationEventNotes({
  reason,
  onuCollectedAt,
  dstvDecoderCollectedAt,
}) {
  const parts = [`Reason: ${reason}`, `ONU collected: ${onuCollectedAt}`];
  if (dstvDecoderCollectedAt) {
    parts.push(`DSTV decoder collected: ${dstvDecoderCollectedAt}`);
  }
  return parts.join(" · ");
}

/**
 * Soft-disconnect: keep the account active but mark service Suspended locally.
 * Caller is responsible for pushing due date = today to TISP.
 */
async function disconnectCustomer(customerId, notes) {
  const customer = await getCustomerContext(customerId);
  if (!customer) throw new Error("Customer not found");
  if (customer.status === "cancelled") {
    throw new Error("Cannot disconnect a cancelled customer");
  }
  if (customer.status !== "active") {
    throw new Error("Customer is not active");
  }

  await updateCustomerSubscriptionStatus(customerId, "Suspended");

  await query(
    `INSERT INTO customer_events (customer_id, event_type, notes)
     VALUES (?, 'disconnect', ?)`,
    [customerId, notes || "Disconnected on TISP (due date set to today)"]
  );

  return customer;
}

/**
 * Temporary pause: keep account active, mark Paused (customer away / not using service).
 * Caller is responsible for pushing due date = today to TISP when on network.
 */
async function pauseCustomer(customerId, payload = {}) {
  const notes =
    typeof payload === "string" ? payload : payload?.notes || payload?.reason;
  const reason = String(
    payload?.reason ?? notes ?? ""
  ).trim();
  const pauseStartDate =
    payload?.pauseStartDate ?? payload?.pause_start_date ?? null;
  const pauseEndDate =
    payload?.pauseEndDate ?? payload?.pause_end_date ?? null;

  if (!reason) {
    throw new Error("Pause reason is required");
  }
  if (!pauseEndDate) {
    throw new Error("Pause end date is required");
  }

  const start =
    formatDateOnly(pauseStartDate) || formatDateOnly(new Date().toISOString());
  const end = formatDateOnly(pauseEndDate);
  if (!end) {
    throw new Error("Pause end date is invalid");
  }
  if (!start) {
    throw new Error("Pause start date is invalid");
  }
  if (end < start) {
    throw new Error("Pause end date must be on or after the start date");
  }

  const creditDays = Math.max(0, Number(payload?.creditDays ?? payload?.pause_credit_days ?? 0) || 0);
  const originalDueDate =
    formatDateOnly(payload?.originalDueDate ?? payload?.pause_original_due_date) || null;
  const creditedDueDate =
    formatDateOnly(payload?.creditedDueDate ?? payload?.pause_credited_due_date) || null;

  const customer = await getCustomerContext(customerId);
  if (!customer) throw new Error("Customer not found");
  if (customer.status === "cancelled") {
    throw new Error("Cannot pause a cancelled customer");
  }
  if (customer.status !== "active") {
    throw new Error("Customer is not active");
  }

  try {
    await query(
      `UPDATE customers
       SET subscription_status = ?,
           pause_start_date = ?,
           pause_end_date = ?,
           pause_reason = ?,
           pause_credit_days = ?,
           pause_original_due_date = ?,
           pause_credited_due_date = ?,
           pause_credit_applied_at = NULL
       WHERE id = ?`,
      ["Paused", start, end, reason, creditDays, originalDueDate, creditedDueDate, customerId]
    );
  } catch (err) {
    if (err.code !== "ER_BAD_FIELD_ERROR") throw err;
    await query(
      `UPDATE customers
       SET subscription_status = ?,
           pause_start_date = ?,
           pause_end_date = ?,
           pause_reason = ?
       WHERE id = ?`,
      ["Paused", start, end, reason, customerId]
    );
  }

  const creditNote =
    creditDays > 0
      ? ` · ${creditDays} day${creditDays === 1 ? "" : "s"} credited on next subscription`
      : "";
  try {
    await query(
      `INSERT INTO customer_events (customer_id, event_type, notes)
       VALUES (?, 'pause', ?)`,
      [customerId, `${reason} (${start} → ${end})${creditNote}`]
    );
  } catch (err) {
    console.warn("pause event insert skipped:", err.message);
  }

  return getCustomerContext(customerId);
}

async function markPauseCreditApplied(customerId, appliedDueDate = null) {
  const id = Number(customerId);
  if (!id) return null;
  const due = formatDateOnly(appliedDueDate);
  try {
    await query(
      `UPDATE customers
       SET pause_credit_applied_at = NOW(),
           pause_credited_due_date = COALESCE(?, pause_credited_due_date),
           subscription_status = CASE
             WHEN LOWER(TRIM(COALESCE(subscription_status, ''))) LIKE '%pause%' THEN 'Active'
             ELSE subscription_status
           END
       WHERE id = ?
         AND pause_credit_applied_at IS NULL`,
      [due, id]
    );
  } catch (err) {
    if (err.code !== "ER_BAD_FIELD_ERROR") throw err;
    await query(
      `UPDATE customers
       SET subscription_status = CASE
             WHEN LOWER(TRIM(COALESCE(subscription_status, ''))) LIKE '%pause%' THEN 'Active'
             ELSE subscription_status
           END
       WHERE id = ?`,
      [id]
    );
  }
  return getCustomerById(id);
}

async function deleteCustomerCompletely(customerId) {
  const customer = await getCustomerById(customerId);
  if (!customer) throw new Error("Customer not found");

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const exec = (sql, params = []) => conn.execute(sql, params);

    await exec(`DELETE FROM pending_upgrades WHERE customer_id = ?`, [customerId]);
    await exec(`DELETE FROM zoho_customer_payments WHERE customer_id = ?`, [customerId]);
    await exec(`DELETE FROM zoho_recurring_invoices WHERE customer_id = ?`, [customerId]);
    await exec(`DELETE FROM zoho_customer_invoices WHERE customer_id = ?`, [customerId]);
    await exec(`DELETE FROM zoho_customer_contacts WHERE customer_id = ?`, [customerId]);
    await exec(`DELETE FROM tisp_customer_snapshots WHERE customer_id = ?`, [customerId]);
    await exec(`DELETE FROM zoho_estimates WHERE customer_id = ?`, [customerId]);
    await exec(`DELETE FROM zoho_credit_notes WHERE customer_id = ?`, [customerId]);
    await exec(`DELETE FROM reconciliation_actions WHERE customer_id = ?`, [customerId]);
    try {
      await exec(`DELETE FROM reconciliation_customer_cache WHERE customer_id = ?`, [
        customerId,
      ]);
    } catch (err) {
      if (err.code !== "ER_NO_SUCH_TABLE") throw err;
    }
    await exec(`DELETE FROM customer_events WHERE customer_id = ?`, [customerId]);
    await exec(`DELETE FROM apartment_history WHERE customer_id = ?`, [customerId]);
    await exec(`DELETE FROM customers WHERE id = ?`, [customerId]);

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return customer;
}

/**
 * Revert a failed TISP IP reclaim so local DB stays aligned with TISP and the
 * next edit can detect ipChanged again (otherwise reclaim never re-runs).
 */
async function revertCustomerIpAddress(customerId, ipAddress) {
  const id = Number(customerId);
  if (!id) return null;
  const ip = ipAddress == null ? null : String(ipAddress).trim() || null;
  await query(`UPDATE customers SET ip_address = ? WHERE id = ?`, [ip, id]);
  await query(
    `UPDATE apartment_history
     SET ip_address = ?
     WHERE customer_id = ? AND moved_out_at IS NULL`,
    [ip, id]
  );
  return getCustomerById(id);
}

async function updateCustomerDetails(id, data, options = {}) {
  const existing = await getCustomerById(id);
  if (!existing) throw new Error("Customer not found");

  let apartmentChanged = false;
  let previousCustomerNumber = null;

  const firstName = String(data.firstName || "").trim();
  const lastName = String(data.lastName || "").trim();
  const middleName = data.middleName ? String(data.middleName).trim() : null;
  const phone = await validateAndNormalizeCustomerPhone(data, {
    existingCustomer: existing,
  });
  const email = await validateAndNormalizeCustomerEmail(data, {
    existingCustomer: existing,
  });
  const customerType = String(data.customerType || existing.customerType)
    .trim()
    .toUpperCase();
  const existingType = String(existing.customerType || "")
    .trim()
    .toUpperCase();
  const agencyId =
    customerType === "B2B" && data.agencyId ? Number(data.agencyId) : null;

  if (!firstName || !lastName) {
    throw new Error("First name and last name are required");
  }
  if (!["C2B", "B2B"].includes(customerType)) {
    throw new Error("Customer type must be C2B or B2B");
  }
  // Type changes renumber the account and migrate TISP — use convert-type only.
  if (customerType !== existingType) {
    throw new Error(
      "Use Convert to C2B/B2B to change billing type (updates customer number and TISP)"
    );
  }
  if (customerType === "B2B" && !agencyId) {
    throw new Error("B2B customers must be linked to an agency");
  }

  const building = await getBuildingById(existing.buildingId);
  if (!building) throw new Error("Building not found");

  const ipCheck = validateIpForBuilding(building, data.ipAddress);
  if (!ipCheck.ok) {
    throw new Error(ipCheck.error);
  }
  const previousIp = existing.ipAddress || null;
  const nextIp = ipCheck.ip || null;
  const ipChanged =
    String(previousIp || "").trim() !== String(nextIp || "").trim();
  if (ipChanged && nextIp) {
    // Free cancelled holders of the new IP (same as create / apartment switch).
    await releaseCancelledIdentityForReuse({
      ipAddress: nextIp,
      excludeCustomerId: id,
    });
  }

  const fullName = [firstName, middleName, lastName].filter(Boolean).join(" ");

  let productId = existing.productId;
  let paymentFrequency = existing.paymentFrequency;
  let customPeriodDays = existing.customPeriodDays;
  let packagePrice = existing.packagePrice;
  let decoderFeeRequired = existing.decoderFeeRequired ? 1 : 0;
  let decoderFeeAmount =
    existing.decoderFeeAmount != null ? Number(existing.decoderFeeAmount) : null;
  let packageChanged = false;
  let previousPackagePrice = existing.packagePrice;
  let previousHasDstv = Boolean(existing.hasDstv);

  if (options.allowPackageEdit) {
    if (data.paymentFrequency != null) {
      paymentFrequency = String(data.paymentFrequency).trim().toLowerCase();
      if (!["monthly", "quarterly", "yearly", "custom"].includes(paymentFrequency)) {
        throw new Error("Invalid payment frequency");
      }
    }
    if (paymentFrequency === "custom") {
      customPeriodDays = Number(
        data.customPeriodDays != null
          ? data.customPeriodDays
          : existing.customPeriodDays
      );
      if (!customPeriodDays || customPeriodDays < 1) {
        throw new Error("Custom period must be at least 1 day");
      }
    } else {
      customPeriodDays = null;
    }
    if (data.productId != null) {
      productId = Number(data.productId);
    }
    const product = await getProductById(productId);
    if (!product) throw new Error("Product not found");
    if (product.building_id !== existing.buildingId) {
      throw new Error("Package must belong to the same building");
    }
    packagePrice = resolvePackagePrice(product, paymentFrequency, customPeriodDays);
    const decoderFee = await resolveDecoderFeeForProduct(product, {
      dstv_setup: existing.buildingDstvSetup,
    });
    decoderFeeRequired = decoderFee.required;
    decoderFeeAmount = decoderFee.amount;
    const newHasDstv = Boolean(product.has_dstv || product.hasDstv);
    packageChanged =
      productId !== existing.productId ||
      paymentFrequency !== existing.paymentFrequency ||
      customPeriodDays !== existing.customPeriodDays;

    // Silent admin package edit must not change billed amounts without Zoho.
    // Higher price / add DSTV → Upgrade. Lower price / remove DSTV → Downgrade.
    if (packageChanged && options.forceLocalPackageCorrection !== true) {
      if (
        packagePrice > previousPackagePrice ||
        (!previousHasDstv && newHasDstv)
      ) {
        const err = new Error(
          "This package change increases the bill or adds DSTV. Use Upgrade Package so Zoho invoices the price difference and the one-time decoder fee. Admin package edit only updates the database and will not correct an already-sent invoice."
        );
        err.code = "PACKAGE_EDIT_REQUIRES_UPGRADE";
        throw err;
      }
      if (
        packagePrice < previousPackagePrice ||
        (previousHasDstv && !newHasDstv)
      ) {
        const err = new Error(
          "This package change decreases the bill or removes DSTV. Use Downgrade Package so billing stays in sync. Admin package edit only updates the database and will not correct Zoho invoices."
        );
        err.code = "PACKAGE_EDIT_REQUIRES_DOWNGRADE";
        throw err;
      }
    }
  }

  const effectiveProduct = await getProductById(productId);
  if (!effectiveProduct) throw new Error("Product not found");

  const dstvDecoderSerial =
    data.dstvDecoderSerial !== undefined
      ? normalizeDstvDecoderSerial(data.dstvDecoderSerial)
      : existing.dstvDecoderSerial;
  assertDstvDecoderSerial(effectiveProduct, building, dstvDecoderSerial);
  await assertDstvSerialUnique(dstvDecoderSerial, id);

  const isPpoe = String(building.ip_setup || "").toUpperCase() === "PPOE";
  let ppoeUsername = existing.ppoeUsername || null;
  let tispPassword = existing.tispPassword || null;
  if (isPpoe) {
    if (data.ppoeUsername !== undefined) {
      ppoeUsername = normalizePppoeUsername(
        data.ppoeUsername,
        existing.customerNumber
      );
      if (!ppoeUsername) throw new Error("PPPoE username is required");
    } else if (!ppoeUsername) {
      ppoeUsername = existing.customerNumber;
    }
    if (data.ppoePassword !== undefined || data.tispPassword !== undefined) {
      const incoming = String(data.ppoePassword ?? data.tispPassword ?? "").trim();
      if (incoming && incoming === String(existing.tispPassword || "")) {
        tispPassword = existing.tispPassword;
      } else {
        tispPassword = normalizePppoePassword(incoming, { required: true });
      }
    } else if (!tispPassword) {
      tispPassword = generatePppoePassword();
    }
  } else {
    ppoeUsername = null;
    tispPassword = existing.tispPassword || existing.apartmentNumber;
  }

  const trimOrNull = (v) => {
    const s = v == null ? "" : String(v).trim();
    return s || null;
  };
  const { buildingToBillingAddress, isBillingAddressEmpty } = require("../utils/buildingBillingAddress");
  let billingAttention =
    data.billingAttention !== undefined
      ? trimOrNull(data.billingAttention)
      : existing.billingAttention || null;
  let billingAddress =
    data.billingAddress !== undefined
      ? trimOrNull(data.billingAddress)
      : existing.billingAddress || null;
  let billingStreet2 =
    data.billingStreet2 !== undefined
      ? trimOrNull(data.billingStreet2)
      : existing.billingStreet2 || null;
  let billingCity =
    data.billingCity !== undefined
      ? trimOrNull(data.billingCity)
      : existing.billingCity || null;
  let billingState =
    data.billingState !== undefined
      ? trimOrNull(data.billingState)
      : existing.billingState || null;
  let billingZip =
    data.billingZip !== undefined
      ? trimOrNull(data.billingZip)
      : existing.billingZip || null;
  let billingCountry =
    data.billingCountry !== undefined
      ? trimOrNull(data.billingCountry)
      : existing.billingCountry || null;
  let hasBilling = !isBillingAddressEmpty({
    billingAttention,
    billingAddress,
    billingStreet2,
    billingCity,
    billingState,
    billingZip,
    billingCountry,
  });
  if (!hasBilling) {
    const fromBuilding = buildingToBillingAddress(building);
    if (fromBuilding) {
      billingAttention = fromBuilding.billingAttention;
      billingAddress = fromBuilding.billingAddress;
      billingStreet2 = fromBuilding.billingStreet2;
      billingCity = fromBuilding.billingCity;
      billingState = fromBuilding.billingState;
      billingZip = fromBuilding.billingZip;
      billingCountry = fromBuilding.billingCountry;
      hasBilling = true;
    }
  }
  billingCountry = hasBilling ? billingCountry || "Kenya" : null;

  const existingPremise = normalizePremiseType(existing.premiseType);
  const businessName =
    existingPremise === "shop"
      ? data.businessName !== undefined
        ? String(data.businessName || "").trim()
        : String(existing.businessName || "").trim()
      : "";
  const shopLocation =
    existingPremise === "shop"
      ? data.shopLocation !== undefined
        ? String(data.shopLocation || "").trim()
        : String(existing.shopLocation || "").trim()
      : "";
  if (existingPremise === "shop") {
    if (!businessName) throw new Error("Business name is required for a shop");
    if (!shopLocation) throw new Error("Shop location is required");
  }

  const contactChanged =
    firstName !== existing.firstName ||
    lastName !== existing.lastName ||
    (middleName || null) !== (existing.middleName || null) ||
    phone !== existing.phone ||
    email !== (existing.email || "") ||
    billingAttention !== (existing.billingAttention || null) ||
    billingAddress !== (existing.billingAddress || null) ||
    billingStreet2 !== (existing.billingStreet2 || null) ||
    billingCity !== (existing.billingCity || null) ||
    billingState !== (existing.billingState || null) ||
    billingZip !== (existing.billingZip || null) ||
    billingCountry !== (existing.billingCountry || null);

  await query(
    `UPDATE customers
     SET first_name = ?, middle_name = ?, last_name = ?, phone = ?, email = ?,
         billing_attention = ?, billing_address = ?, billing_street2 = ?,
         billing_city = ?, billing_state = ?, billing_zip = ?, billing_country = ?,
         is_vat_exempt = ?, customer_type = ?, agency_id = ?, ip_address = ?,
         dstv_decoder_serial = ?,
         tisp_password = ?, ppoe_username = ?,
         business_name = ?, shop_location = ?,
         product_id = ?, payment_frequency = ?, custom_period_days = ?, package_price = ?,
         decoder_fee_required = ?, decoder_fee_amount = ?
     WHERE id = ?`,
    [
      firstName,
      middleName,
      lastName,
      phone,
      email,
      billingAttention,
      billingAddress,
      billingStreet2,
      billingCity,
      billingState,
      billingZip,
      billingCountry,
      data.isVatExempt ? 1 : 0,
      customerType,
      agencyId,
      nextIp,
      dstvDecoderSerial,
      tispPassword,
      isPpoe ? ppoeUsername : null,
      existingPremise === "shop" ? businessName : null,
      existingPremise === "shop" ? shopLocation : null,
      productId,
      paymentFrequency,
      customPeriodDays,
      packagePrice,
      decoderFeeRequired,
      decoderFeeAmount,
      id,
    ]
  );

  if (packageChanged) {
    await query(
      `INSERT INTO customer_events (customer_id, event_type, old_product_id, new_product_id, notes)
       VALUES (?, 'upgrade', ?, ?, ?)`,
      [
        id,
        existing.productId,
        productId,
        `Local package correction (DB only): ${existing.paymentFrequency} → ${paymentFrequency}`,
      ]
    );
  }

  if (ipChanged) {
    await query(
      `UPDATE apartment_history
       SET customer_name = ?, ip_address = ?
       WHERE customer_id = ? AND moved_out_at IS NULL`,
      [fullName, nextIp, id]
    );
  } else {
    await query(
      `UPDATE apartment_history
       SET customer_name = ?
       WHERE customer_id = ? AND moved_out_at IS NULL`,
      [fullName, id]
    );
  }

  if (existing.status === "active") {
    const apartmentNumber = String(data.apartmentNumber || existing.apartmentNumber)
      .trim()
      .toUpperCase();
    if (apartmentNumber !== existing.apartmentNumber) {
      const switchResult = await switchCustomerApartment(id, apartmentNumber, {
        ipAddress: data.ipAddress,
      });
      previousCustomerNumber = switchResult.previousCustomerNumber;
      apartmentChanged = true;
    }
  }

  const customer = await getCustomerById(id);
  const previousProduct = await getProductById(existing.productId);
  const nextProduct = await getProductById(customer?.productId || productId);
  const formatProduct = (product, fallbackName) => {
    if (!product) return fallbackName || null;
    const name = product.name || fallbackName;
    const mbps = product.mbps != null ? `${product.mbps} Mbps` : null;
    if (name && mbps && !String(name).includes("Mbps")) return `${name} (${mbps})`;
    return name || mbps;
  };
  const { diffCustomerDetails } = require("../lib/activityChanges");
  const changes = diffCustomerDetails(existing, customer, {
    previousProductName: formatProduct(previousProduct, existing.productName),
    nextProductName: formatProduct(nextProduct, customer?.productName),
  });

  return {
    customer,
    contactChanged,
    packageChanged,
    apartmentChanged,
    previousCustomerNumber,
    ipChanged: ipChanged && !apartmentChanged,
    previousIp: ipChanged && !apartmentChanged ? previousIp : null,
    changes,
  };
}

async function updateCustomerOltMapping(
  id,
  { buildingOltId, oltMac, onuIndexStr, onuSn }
) {
  const customer = await getCustomerById(id);
  if (!customer) throw new Error("Customer not found");

  const indexStr = String(onuIndexStr || "").trim();
  if (!indexStr) {
    throw new Error("ONU index is required");
  }

  let oltId =
    buildingOltId != null && String(buildingOltId).trim() !== ""
      ? Number(buildingOltId)
      : customer.buildingOltId;
  let mac = String(oltMac || "").trim();

  if (oltId) {
    const olt = await getBuildingOltById(oltId);
    if (!olt) throw new Error("Building OLT not found");
    const customerPopId = Number(customer.popId || customer.pop_id);
    if (Number(olt.pop_id) !== customerPopId) {
      throw new Error("OLT does not belong to this customer's POP");
    }
    mac = String(olt.mac || "").trim();
  } else {
    mac = mac || String(customer.buildingOltMac || "").trim();
    if (mac) {
      const building = await getBuildingById(customer.buildingId);
      if (building) {
        const popOlts = await query(
          `SELECT id FROM pop_olts
           WHERE pop_id = ? AND LOWER(mac) = LOWER(?) LIMIT 1`,
          [building.pop_id, mac]
        );
        if (popOlts[0]) oltId = popOlts[0].id;
      }
    }
  }

  if (!mac) {
    throw new Error("OLT MAC is required — select a POP OLT");
  }

  const sn = onuSn ? String(onuSn).trim() : null;

  await query(
    `UPDATE customers
     SET building_olt_id = ?, olt_mac = ?, onu_index_str = ?, onu_sn = ?
     WHERE id = ?`,
    [oltId || null, mac, indexStr, sn, id]
  );

  return getCustomerById(id);
}

/** Clear ONU index/SN after apartment move so pause/disconnect cannot hit the old port. */
async function clearCustomerOnuMapping(id) {
  const customer = await getCustomerById(id);
  if (!customer) return false;
  if (!customer.onuIndexStr && !customer.onuSn) return false;

  await query(
    `UPDATE customers SET onu_index_str = NULL, onu_sn = NULL WHERE id = ?`,
    [id]
  );
  return true;
}

async function getBuildingMapped(id) {
  const row = await getBuildingById(id);
  if (!row) return null;
  const olts = await listBuildingOlts(id);
  return mapBuildingRow(row, olts);
}

async function convertCustomerType(customerId, targetType, agencyId = null) {
  const customer = await getCustomerContext(customerId);
  if (!customer) throw new Error("Customer not found");
  if (customer.status !== "active") {
    throw new Error("Only active customers can change billing type");
  }

  const currentType = String(customer.customer_type).toUpperCase();
  const nextType = String(targetType).toUpperCase();
  if (!["C2B", "B2B"].includes(nextType)) {
    throw new Error("Customer type must be C2B or B2B");
  }
  if (currentType === nextType) {
    throw new Error(`Customer is already ${nextType}`);
  }
  const [pendingUpgrade] = await query(
    `SELECT id
     FROM pending_upgrades
     WHERE customer_id = ? AND status = 'payment_pending'
     LIMIT 1`,
    [customerId]
  );
  if (pendingUpgrade?.id) {
    throw new Error(
      "Customer has a pending upgrade payment. Resolve/cancel it before changing billing type."
    );
  }

  let resolvedAgencyId = null;
  if (nextType === "B2B") {
    if (!agencyId) {
      throw new Error("B2B customers must be linked to an agency");
    }
    const agency = await getAgencyById(agencyId);
    if (!agency) throw new Error("Agency not found");
    resolvedAgencyId = agency.id;
  }

  const building = await getBuildingById(customer.building_id);
  if (!building) throw new Error("Building not found");

  const newCustomerNumber = buildCustomerNumber(
    building,
    nextType,
    customer.apartment_number,
    customer.premise_type
  );

  await releaseCancelledIdentityForReuse({
    customerNumber: newCustomerNumber,
    excludeCustomerId: customerId,
  });

  const oldNumber = customer.customer_number;
  const previousAgencyId = customer.agency_id || null;
  const previousPpoeUsername = String(customer.ppoe_username || "")
    .trim()
    .toUpperCase();
  const isPpoe = String(building.ip_setup || "").toUpperCase() === "PPOE";
  // Keep custom PPPoE usernames; when username tracked the account number, renumber it.
  const nextPpoeUsername = isPpoe
    ? !previousPpoeUsername ||
      previousPpoeUsername === String(oldNumber || "").toUpperCase()
      ? newCustomerNumber
      : previousPpoeUsername
    : null;

  const agencyName =
    resolvedAgencyId != null
      ? (await getAgencyById(resolvedAgencyId))?.name || null
      : null;

  const pool = getPool();
  const conn = await pool.getConnection();
  let movedPaymentReferences = 0;
  let movedIntegrationReferences = 0;
  try {
    await conn.beginTransaction();

    await conn.query(
      `UPDATE customers
       SET customer_type = ?, agency_id = ?, customer_number = ?, ppoe_username = ?
       WHERE id = ?`,
      [nextType, resolvedAgencyId, newCustomerNumber, nextPpoeUsername, customerId]
    );

    await conn.query(
      `UPDATE apartment_history SET customer_number = ?
       WHERE customer_id = ? AND moved_out_at IS NULL`,
      [newCustomerNumber, customerId]
    );

    // Keep payment/integration lookups consistent after account renumbering.
    const [txUpdate] = await conn.query(
      `UPDATE payment_transactions
       SET account_reference = ?
       WHERE UPPER(TRIM(COALESCE(account_reference, ''))) = UPPER(?)`,
      [newCustomerNumber, oldNumber]
    );
    movedPaymentReferences = Number(txUpdate?.affectedRows || 0);

    const [ieUpdate] = await conn.query(
      `UPDATE integration_events
       SET customer_no = ?
       WHERE UPPER(TRIM(COALESCE(customer_no, ''))) = UPPER(?)`,
      [newCustomerNumber, oldNumber]
    );
    movedIntegrationReferences = Number(ieUpdate?.affectedRows || 0);

    await conn.query(
      `INSERT INTO customer_events (customer_id, event_type, notes)
       VALUES (?, 'type_change', ?)`,
      [
        customerId,
        `Converted from ${currentType} to ${nextType}${
          agencyName ? ` · agency: ${agencyName}` : ""
        } · ${oldNumber} → ${newCustomerNumber}`,
      ]
    );

    await conn.commit();
  } catch (error) {
    try {
      await conn.rollback();
    } catch {
      /* ignore rollback errors */
    }
    throw error;
  } finally {
    conn.release();
  }

  return {
    customer: await getCustomerById(customerId),
    previousType: currentType,
    newType: nextType,
    previousCustomerNumber: oldNumber,
    previousAgencyId,
    previousPpoeUsername: previousPpoeUsername || null,
    newCustomerNumber,
    agencyId: resolvedAgencyId,
    agencyName,
    movedPaymentReferences,
    movedIntegrationReferences,
  };
}

async function getApartmentHistory(buildingId, apartmentNumber) {
  const rows = await query(
    `SELECT h.id, h.apartment_number AS apartmentNumber, h.customer_number AS customerNumber,
            h.customer_name AS customerName, h.moved_in_at AS movedInAt,
            h.moved_out_at AS movedOutAt, h.reason, b.name AS buildingName,
            b.id AS buildingId, c.id AS customerId, c.status AS customerStatus,
            c.phone, c.email, c.customer_type AS customerType,
            c.payment_frequency AS paymentFrequency, c.custom_period_days AS customPeriodDays,
            c.package_price AS packagePrice, c.last_payment_date AS lastPaymentDate,
            c.subscription_status AS subscriptionStatus,
            p.name AS productName, p.mbps AS productMbps,
            COALESCE(
              NULLIF(TRIM(h.ip_address), ''),
              CASE WHEN h.moved_out_at IS NULL THEN NULLIF(TRIM(c.ip_address), '') ELSE NULL END
            ) AS ipAddress,
            h.onu_collected_at AS onuCollectedAt,
            h.dstv_decoder_collected_at AS dstvDecoderCollectedAt,
            c.cancellation_reason AS cancellationReason
     FROM apartment_history h
     JOIN buildings b ON b.id = h.building_id
     JOIN customers c ON c.id = h.customer_id
     JOIN products p ON p.id = c.product_id
     WHERE h.building_id = ? AND h.apartment_number = ?
     ORDER BY h.moved_in_at DESC`,
    [buildingId, String(apartmentNumber).trim().toUpperCase()]
  );
  return rows.map(mapApartmentHistoryRow);
}

function mapApartmentHistoryRow(row) {
  return {
    id: row.id,
    buildingId: row.buildingId,
    buildingName: row.buildingName,
    apartmentNumber: row.apartmentNumber,
    customerId: row.customerId,
    customerNumber: row.customerNumber,
    customerName: row.customerName,
    movedInAt: row.movedInAt,
    movedOutAt: row.movedOutAt,
    reason: row.reason,
    customerStatus: row.customerStatus,
    isCurrent: row.movedOutAt == null,
    ipAddress: row.ipAddress || null,
    phone: row.phone,
    email: row.email,
    customerType: row.customerType,
    paymentFrequency: row.paymentFrequency,
    customPeriodDays: row.customPeriodDays,
    packagePrice: row.packagePrice != null ? Number(row.packagePrice) : null,
    lastPaymentDate: row.lastPaymentDate,
    subscriptionStatus: row.subscriptionStatus,
    productName: row.productName,
    productMbps: row.productMbps != null ? Number(row.productMbps) : null,
    onuCollectedAt: row.onuCollectedAt
      ? String(row.onuCollectedAt).slice(0, 10)
      : null,
    dstvDecoderCollectedAt: row.dstvDecoderCollectedAt
      ? String(row.dstvDecoderCollectedAt).slice(0, 10)
      : null,
    cancellationReason: row.cancellationReason || null,
  };
}

async function listApartmentHistory(filters = {}) {
  const clauses = ["1=1"];
  const params = [];

  if (filters.buildingId) {
    clauses.push("h.building_id = ?");
    params.push(filters.buildingId);
  }
  if (filters.apartmentNumber) {
    clauses.push("h.apartment_number LIKE ?");
    params.push(`%${String(filters.apartmentNumber).trim().toUpperCase()}%`);
  }
  if (filters.currentOnly === true || filters.currentOnly === "true") {
    clauses.push("h.moved_out_at IS NULL");
  }
  if (filters.search) {
    const term = `%${String(filters.search).trim()}%`;
    clauses.push(
      "(h.customer_name LIKE ? OR h.customer_number LIKE ? OR h.apartment_number LIKE ? OR b.name LIKE ?)"
    );
    params.push(term, term, term, term);
  }

  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
  const offset = (page - 1) * limit;

  const { resolveListSort } = require("../utils/listSort");
  const sort = resolveListSort(filters, {
    allowed: [
      { key: "buildingName", sql: "b.name" },
      { key: "apartmentNumber", sql: "h.apartment_number" },
      { key: "customerName", sql: "h.customer_name" },
      { key: "customerNumber", sql: "h.customer_number" },
      { key: "movedInAt", sql: "h.moved_in_at" },
      { key: "movedOutAt", sql: "h.moved_out_at" },
      { key: "reason", sql: "h.reason" },
      { key: "customerStatus", sql: "c.status" },
    ],
    defaultSort: { sortBy: "movedInAt", sortDir: "desc" },
  });

  const [countRow] = await query(
    `SELECT COUNT(*) AS total
     FROM apartment_history h
     JOIN buildings b ON b.id = h.building_id
     JOIN customers c ON c.id = h.customer_id
     JOIN products p ON p.id = c.product_id
     WHERE ${clauses.join(" AND ")}`,
    params
  );

  const rows = await query(
    `SELECT h.id, h.apartment_number AS apartmentNumber, h.customer_number AS customerNumber,
            h.customer_name AS customerName, h.moved_in_at AS movedInAt,
            h.moved_out_at AS movedOutAt, h.reason, b.name AS buildingName,
            b.id AS buildingId, c.id AS customerId, c.status AS customerStatus,
            c.phone, c.email, c.customer_type AS customerType,
            c.payment_frequency AS paymentFrequency, c.custom_period_days AS customPeriodDays,
            c.package_price AS packagePrice, c.last_payment_date AS lastPaymentDate,
            c.subscription_status AS subscriptionStatus,
            p.name AS productName, p.mbps AS productMbps,
            COALESCE(
              NULLIF(TRIM(h.ip_address), ''),
              CASE WHEN h.moved_out_at IS NULL THEN NULLIF(TRIM(c.ip_address), '') ELSE NULL END
            ) AS ipAddress,
            h.onu_collected_at AS onuCollectedAt,
            h.dstv_decoder_collected_at AS dstvDecoderCollectedAt,
            c.cancellation_reason AS cancellationReason
     FROM apartment_history h
     JOIN buildings b ON b.id = h.building_id
     JOIN customers c ON c.id = h.customer_id
     JOIN products p ON p.id = c.product_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY ${sort.orderClause}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    data: rows.map(mapApartmentHistoryRow),
    pagination: {
      page,
      limit,
      total: Number(countRow.total),
      pages: Math.ceil(Number(countRow.total) / limit) || 1,
    },
  };
}

async function getCustomerEvents(customerId) {
  return query(
    `SELECT e.id, e.event_type AS eventType, e.old_apartment AS oldApartment,
            e.new_apartment AS newApartment, e.notes, e.created_at AS createdAt,
            op.name AS oldProductName, np.name AS newProductName
     FROM customer_events e
     LEFT JOIN products op ON op.id = e.old_product_id
     LEFT JOIN products np ON np.id = e.new_product_id
     WHERE e.customer_id = ?
     ORDER BY e.created_at DESC`,
    [customerId]
  );
}

async function getBuildingByName(name) {
  const rows = await query(
    `SELECT b.*,
            p.name AS pop_name,
            p.c2b_code, p.b2b_code, p.ip_setup, p.dstv_setup,
            p.ip_prefixes AS pop_ip_prefixes
     FROM buildings b
     JOIN pops p ON p.id = b.pop_id
     WHERE LOWER(b.name) = LOWER(?) LIMIT 1`,
    [String(name || "").trim()]
  );
  return rows[0] || null;
}

async function findProductForImport(buildingId, productName, paymentFrequency) {
  const freq = paymentFrequency === "custom" ? "monthly" : paymentFrequency;
  const trimmed = String(productName || "").trim();
  const rows = await query(
    `SELECT p.id
     FROM products p
     LEFT JOIN package_plan_variants v ON v.id = p.plan_variant_id
     LEFT JOIN package_plans pl ON pl.id = v.plan_id
     LEFT JOIN package_categories c ON c.id = pl.category_id
     WHERE p.building_id = ?
       AND p.payment_frequency = ?
       AND p.is_active = 1
       AND (
         p.name = ?
         OR CONCAT(pl.name, ' — ', c.name) = ?
         OR CONCAT(pl.name, ' · ', c.name) = ?
         OR CONCAT(pl.name, ' - ', c.name) = ?
       )
     LIMIT 1`,
    [buildingId, freq, trimmed, trimmed, trimmed, trimmed]
  );
  return rows[0] || null;
}

async function getAgencyByName(name) {
  if (!name || !String(name).trim()) return null;
  const rows = await query(`SELECT id FROM agencies WHERE name = ? LIMIT 1`, [
    String(name).trim(),
  ]);
  return rows[0] || null;
}

async function findCustomerByNumber(customerNumber) {
  const rows = await query(
    `SELECT id, customer_number, ip_address, status
     FROM customers WHERE customer_number = ? LIMIT 1`,
    [String(customerNumber || "").trim()]
  );
  return rows[0] || null;
}

/**
 * Resolve a messy M-Pesa BillRefNumber to a live dashboard customer.
 * Accepts ET-T506, "ET T506", et-t506, ETT506, and unique apartment tokens (t506).
 * Uses the paying MSISDN to break ties when several apartments share the token.
 */
async function resolveCustomerByPaybillRef(rawRef, options = {}) {
  const raw = String(rawRef || "").trim();
  const { normalized, compact, lastSegment } = paybillRefTokens(raw);
  if (!compact || compact.length < 3) return null;

  const clauses = [
    "UPPER(TRIM(customer_number)) = ?",
    `UPPER(REPLACE(REPLACE(REPLACE(REPLACE(customer_number, '-', ''), ' ', ''), '_', ''), '/', '')) = ?`,
  ];
  const params = [normalized, compact];

  if (lastSegment.length >= 3) {
    clauses.push("UPPER(TRIM(customer_number)) LIKE ?");
    clauses.push("UPPER(TRIM(apartment_number)) = ?");
    params.push(`%-${escapeLike(lastSegment)}`);
    params.push(lastSegment);
  }

  const rows = await query(
    `SELECT id, customer_number, apartment_number, phone, status, customer_type
     FROM customers
     WHERE LOWER(COALESCE(status, '')) != 'cancelled'
       AND customer_number NOT LIKE '%-CXL-%'
       AND (${clauses.join(" OR ")})
     LIMIT 25`,
    params
  );
  if (!rows.length) return null;

  const candidates = rows.map((row) => ({
    id: row.id,
    customerNumber: row.customer_number,
    apartmentNumber: row.apartment_number,
    phone: row.phone,
    status: row.status,
    customerType: row.customer_type,
  }));
  const picked = pickUniquePaybillCustomer(candidates, raw, {
    msisdn: options.msisdn,
  });
  if (!picked?.id) return null;
  return getCustomerById(picked.id);
}

/**
 * Find a customer by exact apartment number (active preferred).
 * When preferredBuildingId is set, same-building tenants win.
 */
async function findCustomerByApartmentNumber(
  apartmentNumber,
  { preferredBuildingId = null, activeOnly = false } = {}
) {
  const apt = String(apartmentNumber || "").trim().toUpperCase();
  if (!apt) return null;

  const preferBuilding =
    preferredBuildingId != null && Number(preferredBuildingId) > 0
      ? Number(preferredBuildingId)
      : null;

  const params = [apt];
  let statusSql = "";
  if (activeOnly) {
    statusSql = ` AND LOWER(status) = 'active'`;
  }

  let orderSql = `ORDER BY id DESC`;
  if (preferBuilding) {
    orderSql = `ORDER BY CASE WHEN building_id = ? THEN 0 ELSE 1 END, id DESC`;
    params.push(preferBuilding);
  }

  const rows = await query(
    `SELECT id, customer_number, ip_address, status, building_id, apartment_number,
            first_name, middle_name, last_name
     FROM customers
     WHERE UPPER(TRIM(apartment_number)) = ?${statusSql}
     ${orderSql}
     LIMIT 1`,
    params
  );
  return rows[0] || null;
}

async function findCustomerByIp(ipAddress) {
  if (!ipAddress) return null;
  const rows = await query(
    `SELECT id, customer_number, ip_address, status
     FROM customers WHERE ip_address = ? LIMIT 1`,
    [String(ipAddress).trim()]
  );
  return rows[0] || null;
}

async function assertImportNotDuplicate({
  customerNumber,
  ipAddress,
  dstvDecoderSerial,
  batchSeen,
}) {
  const normalizedNumber = String(customerNumber || "").trim();
  if (!normalizedNumber) {
    throw new Error("Customer number could not be determined");
  }

  if (batchSeen?.customerNumbers?.has(normalizedNumber)) {
    throw new Error(
      `Duplicate customer number in import file: ${normalizedNumber}`
    );
  }

  if (ipAddress && batchSeen?.ipAddresses?.has(ipAddress)) {
    throw new Error(`Duplicate IP address in import file: ${ipAddress}`);
  }

  const normalizedDstvSerial = normalizeDstvDecoderSerial(dstvDecoderSerial);
  if (normalizedDstvSerial && batchSeen?.dstvSerials?.has(normalizedDstvSerial)) {
    throw new Error(
      `Duplicate DSTV decoder serial in import file: ${normalizedDstvSerial}`
    );
  }

  const existingByNumber = await findCustomerByNumber(normalizedNumber);
  if (existingByNumber) {
    if (existingByNumber.status === "active") {
      throw new Error(`Customer number already exists: ${normalizedNumber}`);
    }
    await releaseCancelledIdentityForReuse({ customerNumber: normalizedNumber });
  }

  if (ipAddress) {
    const existingByIp = await findCustomerByIp(ipAddress);
    if (existingByIp) {
      if (existingByIp.status === "active") {
        throw new Error(
          `IP address ${ipAddress} is already assigned to ${existingByIp.customer_number}`
        );
      }
      await releaseCancelledIdentityForReuse({ ipAddress });
    }
  }

  if (normalizedDstvSerial) {
    const existingByDstv = await findCustomerByDstvSerial(normalizedDstvSerial);
    if (existingByDstv) {
      if (existingByDstv.status === "active") {
        throw new Error(
          `DSTV decoder serial ${normalizedDstvSerial} is already assigned to ${existingByDstv.customer_number}`
        );
      }
      await releaseCancelledIdentityForReuse({
        dstvDecoderSerial: normalizedDstvSerial,
      });
    }
  }
}

function registerImportBatchEntry(batchSeen, { customerNumber, ipAddress, dstvDecoderSerial }) {
  if (!batchSeen) return;
  const normalizedNumber = String(customerNumber || "").trim();
  if (normalizedNumber) {
    batchSeen.customerNumbers.add(normalizedNumber);
  }
  if (ipAddress) {
    batchSeen.ipAddresses.add(ipAddress);
  }
  const normalizedDstvSerial = normalizeDstvDecoderSerial(dstvDecoderSerial);
  if (normalizedDstvSerial) {
    batchSeen.dstvSerials.add(normalizedDstvSerial);
  }
}

async function importCustomerFromRow(row, batchSeen) {
  const { buildIpAddress } = require("../config/buildingIpRules");

  if (!row.first_name || !row.last_name) {
    throw new Error("first_name and last_name are required");
  }
  const premiseType = normalizePremiseType(row.premise_type);
  const isShop = premiseType === "shop";
  if (!row.phone || !row.building_name || !row.product_name) {
    throw new Error("phone, building_name, and product_name are required");
  }
  if (!isShop && !row.apartment_number) {
    throw new Error("phone, apartment_number, building_name, and product_name are required");
  }
  if (isShop && (!row.business_name || !row.shop_location)) {
    throw new Error("business_name and shop_location are required for a shop");
  }

  const customerType = String(row.customer_type || "C2B").trim().toUpperCase();
  if (!["C2B", "B2B"].includes(customerType)) {
    throw new Error("customer_type must be C2B or B2B");
  }

  const paymentFrequency = String(row.payment_frequency || "monthly")
    .trim()
    .toLowerCase();
  if (!["monthly", "quarterly", "yearly", "custom"].includes(paymentFrequency)) {
    throw new Error("Invalid payment_frequency");
  }

  const building = await getBuildingByName(row.building_name);
  if (!building) throw new Error(`Building not found: ${row.building_name}`);

  const product = await findProductForImport(
    building.id,
    row.product_name,
    paymentFrequency
  );
  if (!product) {
    throw new Error(
      `Product "${row.product_name}" not found for ${row.building_name} (${paymentFrequency})`
    );
  }

  let ipAddress = null;
  if (row.ip_prefix && row.ip_last_octet) {
    ipAddress = buildIpAddress(row.ip_prefix, row.ip_last_octet);
  }

  const apartmentNumber = isShop
    ? shopLocationCode(row.shop_location)
    : String(row.apartment_number).trim().toUpperCase();
  if (isShop && !apartmentNumber) {
    throw new Error("Shop location must include letters or numbers");
  }
  const customerNumber = buildCustomerNumber(
    building,
    customerType,
    apartmentNumber,
    premiseType
  );

  const ipCheck = validateIpForBuilding(building, ipAddress);
  if (!ipCheck.ok) {
    throw new Error(ipCheck.error);
  }
  ipAddress = ipCheck.ip;

  await assertImportNotDuplicate({
    customerNumber,
    ipAddress,
    dstvDecoderSerial: row.dstv_decoder_serial,
    batchSeen,
  });

  await assertApartmentAvailable(building.id, apartmentNumber);

  const agency = row.agency_name ? await getAgencyByName(row.agency_name) : null;
  if (customerType === "B2B" && !agency) {
    throw new Error(`Agency not found: ${row.agency_name || "(required for B2B)"}`);
  }

  const created = await createCustomer({
    firstName: row.first_name,
    lastName: row.last_name,
    middleName: row.middle_name || undefined,
    phone: row.phone,
    email: row.email || undefined,
    ipAddress,
    isVatExempt: ["yes", "y", "true", "1"].includes(
      String(row.is_vat_exempt || "no").toLowerCase()
    ),
    customerType,
    premiseType,
    businessName: isShop ? String(row.business_name).trim() : undefined,
    shopLocation: isShop ? String(row.shop_location).trim() : undefined,
    apartmentNumber,
    paymentFrequency,
    customPeriodDays: row.custom_period_days
      ? Number(row.custom_period_days)
      : row.custom_period_months
        ? Number(row.custom_period_months) * 30
        : undefined,
    buildingId: building.id,
    productId: product.id,
    agencyId: agency?.id,
    dstvDecoderSerial: row.dstv_decoder_serial || undefined,
  });

  registerImportBatchEntry(batchSeen, {
    customerNumber,
    ipAddress,
    dstvDecoderSerial: row.dstv_decoder_serial,
  });

  return created;
}

async function getSubscriberStats(days = 29) {
  const [
    [row],
    [newInPeriod],
    [buildingCount],
    [agencyCount],
    topBuildings,
    topPackages,
    [serviceBreakdown],
  ] = await Promise.all([
    query(`
      SELECT
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
        SUM(CASE WHEN status = 'active' AND customer_type = 'C2B' THEN 1 ELSE 0 END) AS c2b_count,
        SUM(CASE WHEN status = 'active' AND customer_type = 'B2B' THEN 1 ELSE 0 END) AS b2b_count,
        SUM(CASE WHEN status = 'active' AND tisp_sync_status = 'failed' THEN 1 ELSE 0 END) AS tisp_failed,
        SUM(CASE WHEN status = 'active' AND tisp_sync_status = 'pending' THEN 1 ELSE 0 END) AS tisp_pending
      FROM customers
    `),
    query(
      `SELECT COUNT(*) AS count FROM customers
       WHERE status = 'active'
         AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
      [days]
    ),
    query(`SELECT COUNT(*) AS count FROM buildings`),
    query(`SELECT COUNT(*) AS count FROM agencies`),
    query(`
      SELECT b.name AS building, COUNT(*) AS subscribers
      FROM customers c
      JOIN buildings b ON b.id = c.building_id
      WHERE c.status = 'active'
      GROUP BY b.id, b.name
      ORDER BY subscribers DESC
      LIMIT 20
    `),
    query(`
      SELECT p.name AS package_name, p.mbps, COUNT(*) AS subscribers
      FROM customers c
      JOIN products p ON p.id = c.product_id
      WHERE c.status = 'active'
      GROUP BY p.id, p.name, p.mbps
      ORDER BY subscribers DESC
      LIMIT 8
    `),
    query(`
      SELECT
        SUM(CASE WHEN LOWER(TRIM(COALESCE(ts.subscription_status, ''))) = 'active' THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN LOWER(TRIM(COALESCE(ts.subscription_status, '')) ) LIKE '%pause%' THEN 1 ELSE 0 END) AS paused_count,
        SUM(CASE
          WHEN LOWER(TRIM(COALESCE(ts.subscription_status, ''))) LIKE '%pause%' THEN 0
          WHEN LOWER(TRIM(COALESCE(ts.subscription_status, ''))) LIKE '%cancel%' THEN 0
          WHEN LOWER(TRIM(COALESCE(ts.subscription_status, ''))) LIKE '%suspend%' THEN 1
          WHEN ts.subscription_status IS NULL
            OR TRIM(ts.subscription_status) = ''
            OR LOWER(TRIM(ts.subscription_status)) IN ('unknown', 'not on tisp', 'not_on_tisp')
            OR LOWER(TRIM(ts.subscription_status)) <> 'active'
          THEN 1 ELSE 0 END) AS suspended_count
      FROM customers c
      LEFT JOIN tisp_customer_snapshots ts ON ts.customer_id = c.id
      WHERE c.status = 'active'
    `),
  ]);

  return {
    // "Customers" = active accounts only (cancelled are churn, not current customers).
    total: Number(row?.total || 0),
    active: Number(row?.active_count || 0),
    cancelled: Number(row?.cancelled_count || 0),
    c2b: Number(row?.c2b_count || 0),
    b2b: Number(row?.b2b_count || 0),
    tispFailed: Number(row?.tisp_failed || 0),
    tispPending: Number(row?.tisp_pending || 0),
    newInPeriod: Number(newInPeriod?.count || 0),
    buildings: Number(buildingCount?.count || 0),
    agencies: Number(agencyCount?.count || 0),
    topBuildings: topBuildings.map((d) => ({
      building: d.building,
      subscribers: Number(d.subscribers),
    })),
    topPackages: topPackages.map((d) => ({
      package: formatProductNameForDisplay(d.package_name),
      mbps: Number(d.mbps),
      subscribers: Number(d.subscribers),
    })),
    avgCustomerPayment: 0,
    avgPaymentsPerCustomer: 0,
    tispActive: Number(serviceBreakdown?.active_count || 0),
    tispSuspended: Number(serviceBreakdown?.suspended_count || 0),
    tispPaused: Number(serviceBreakdown?.paused_count || 0),
    // Legacy alias — same as suspended (includes not-on-TISP).
    tispUnknown: Number(serviceBreakdown?.suspended_count || 0),
  };
}

function mapApartmentUnitRow(row) {
  const occupied = Boolean(row.currentCustomerId);
  return {
    buildingId: Number(row.buildingId),
    buildingName: row.buildingName,
    c2bCode: row.c2bCode,
    b2bCode: row.b2bCode,
    ipSetup: row.ipSetup,
    dstvSetup: row.dstvSetup || null,
    apartmentNumber: row.apartmentNumber,
    occupancyStatus: occupied ? "occupied" : "vacant",
    occupied,
    currentIp: row.currentIp || null,
    lastKnownIp: row.lastKnownIp || row.currentIp || null,
    currentCustomerId: row.currentCustomerId != null ? Number(row.currentCustomerId) : null,
    currentCustomerNumber: row.currentCustomerNumber || null,
    tenureCount: Number(row.tenureCount || 0),
    firstOccupiedAt: row.firstOccupiedAt || null,
    lastActivityAt: row.lastActivityAt || null,
    occupiedSince: occupied ? row.occupiedSince || null : null,
  };
}

async function listApartments(filters = {}) {
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
  const offset = (page - 1) * limit;

  const { resolveListSort } = require("../utils/listSort");

  const listFrom = `
    FROM (
      SELECT building_id,
             apartment_number,
             COUNT(*) AS tenure_count,
             MIN(moved_in_at) AS first_occupied_at,
             MAX(COALESCE(moved_out_at, moved_in_at)) AS last_activity_at
      FROM apartment_history
      GROUP BY building_id, apartment_number
    ) units
    JOIN buildings b ON b.id = units.building_id
    JOIN pops pop ON pop.id = b.pop_id
    LEFT JOIN apartment_history open_h
      ON open_h.building_id = units.building_id
     AND open_h.apartment_number = units.apartment_number
     AND open_h.moved_out_at IS NULL
    LEFT JOIN customers open_c ON open_c.id = open_h.customer_id
    LEFT JOIN (
      SELECT h1.building_id,
             h1.apartment_number,
             h1.ip_address
      FROM apartment_history h1
      INNER JOIN (
        SELECT building_id, apartment_number, MAX(id) AS max_id
        FROM apartment_history
        WHERE ip_address IS NOT NULL AND TRIM(ip_address) <> ''
        GROUP BY building_id, apartment_number
      ) latest ON latest.max_id = h1.id
    ) last_ip
      ON last_ip.building_id = units.building_id
     AND last_ip.apartment_number = units.apartment_number
  `;

  const whereClauses = ["1=1"];
  const whereParams = [];
  if (filters.buildingId) {
    whereClauses.push("units.building_id = ?");
    whereParams.push(Number(filters.buildingId));
  }
  if (filters.apartmentNumber) {
    whereClauses.push("units.apartment_number LIKE ?");
    whereParams.push(`%${String(filters.apartmentNumber).trim().toUpperCase()}%`);
  }
  if (filters.search) {
    const term = `%${String(filters.search).trim()}%`;
    whereClauses.push(
      `(units.apartment_number LIKE ? OR b.name LIKE ? OR open_h.customer_number LIKE ? OR COALESCE(NULLIF(TRIM(open_h.ip_address), ''), NULLIF(TRIM(open_c.ip_address), ''), NULLIF(TRIM(last_ip.ip_address), '')) LIKE ?)`
    );
    whereParams.push(term, term, term, term);
  }
  if (filters.occupancy === "occupied") {
    whereClauses.push("open_h.customer_id IS NOT NULL");
  } else if (filters.occupancy === "vacant") {
    whereClauses.push("open_h.customer_id IS NULL");
  }

  const sort = resolveListSort(filters, {
    allowed: [
      { key: "buildingName", sql: "b.name" },
      { key: "apartmentNumber", sql: "units.apartment_number" },
      {
        key: "occupancyStatus",
        sql: "CASE WHEN open_h.customer_id IS NULL THEN 0 ELSE 1 END",
      },
      {
        key: "currentIp",
        sql: "COALESCE(NULLIF(TRIM(open_h.ip_address), ''), NULLIF(TRIM(open_c.ip_address), ''), NULLIF(TRIM(last_ip.ip_address), ''))",
      },
      { key: "tenureCount", sql: "units.tenure_count" },
      { key: "lastActivityAt", sql: "units.last_activity_at" },
    ],
    defaultSort: { sortBy: "buildingName", sortDir: "asc" },
  });

  const [countRow] = await query(
    `SELECT COUNT(*) AS total ${listFrom} WHERE ${whereClauses.join(" AND ")}`,
    whereParams
  );

  const rows = await query(
    `SELECT b.id AS buildingId,
            b.name AS buildingName,
            pop.c2b_code AS c2bCode,
            pop.b2b_code AS b2bCode,
            pop.ip_setup AS ipSetup,
            pop.dstv_setup AS dstvSetup,
            units.apartment_number AS apartmentNumber,
            units.tenure_count AS tenureCount,
            units.first_occupied_at AS firstOccupiedAt,
            units.last_activity_at AS lastActivityAt,
            open_h.customer_id AS currentCustomerId,
            open_h.customer_number AS currentCustomerNumber,
            open_h.moved_in_at AS occupiedSince,
            COALESCE(
              NULLIF(TRIM(open_h.ip_address), ''),
              NULLIF(TRIM(open_c.ip_address), '')
            ) AS currentIp,
            COALESCE(
              NULLIF(TRIM(open_h.ip_address), ''),
              NULLIF(TRIM(open_c.ip_address), ''),
              NULLIF(TRIM(last_ip.ip_address), '')
            ) AS lastKnownIp
     ${listFrom}
     WHERE ${whereClauses.join(" AND ")}
     ORDER BY ${sort.orderClause}, units.apartment_number ASC
     LIMIT ? OFFSET ?`,
    [...whereParams, limit, offset]
  );

  return {
    data: rows.map(mapApartmentUnitRow),
    pagination: {
      page,
      limit,
      total: Number(countRow.total),
      pages: Math.ceil(Number(countRow.total) / limit) || 1,
    },
  };
}

async function getApartment(buildingId, apartmentNumber) {
  const apt = String(apartmentNumber || "").trim().toUpperCase();
  const building = await getBuildingById(buildingId);
  if (!building) return null;

  const [stats] = await query(
    `SELECT COUNT(*) AS tenureCount,
            MIN(moved_in_at) AS firstOccupiedAt,
            MAX(COALESCE(moved_out_at, moved_in_at)) AS lastActivityAt
     FROM apartment_history
     WHERE building_id = ? AND apartment_number = ?`,
    [buildingId, apt]
  );
  if (!stats || Number(stats.tenureCount) === 0) return null;

  const [open] = await query(
    `SELECT h.customer_id AS currentCustomerId,
            h.customer_number AS currentCustomerNumber,
            h.moved_in_at AS occupiedSince,
            COALESCE(NULLIF(TRIM(h.ip_address), ''), NULLIF(TRIM(c.ip_address), '')) AS currentIp
     FROM apartment_history h
     LEFT JOIN customers c ON c.id = h.customer_id
     WHERE h.building_id = ? AND h.apartment_number = ? AND h.moved_out_at IS NULL
     LIMIT 1`,
    [buildingId, apt]
  );

  const [lastIpRow] = await query(
    `SELECT ip_address AS ipAddress
     FROM apartment_history
     WHERE building_id = ? AND apartment_number = ?
       AND ip_address IS NOT NULL AND TRIM(ip_address) <> ''
     ORDER BY id DESC
     LIMIT 1`,
    [buildingId, apt]
  );

  return mapApartmentUnitRow({
    buildingId: building.id,
    buildingName: building.name,
    c2bCode: building.c2b_code,
    b2bCode: building.b2b_code,
    ipSetup: building.ip_setup,
    dstvSetup: building.dstv_setup,
    apartmentNumber: apt,
    tenureCount: stats.tenureCount,
    firstOccupiedAt: stats.firstOccupiedAt,
    lastActivityAt: stats.lastActivityAt,
    currentCustomerId: open?.currentCustomerId ?? null,
    currentCustomerNumber: open?.currentCustomerNumber ?? null,
    occupiedSince: open?.occupiedSince ?? null,
    currentIp: open?.currentIp ?? null,
    lastKnownIp: open?.currentIp || lastIpRow?.ipAddress || null,
  });
}

module.exports = {
  generatePppoePassword,
  splitFullName,
  buildCustomerNumber,
  resolvePackagePrice,
  listPops,
  getPopById,
  getPopMapped,
  createPop,
  updatePop,
  listBuildings,
  createBuilding,
  updateBuilding,
  mapBuildingRow,
  mapBuildingOltRow,
  mapPopOltRow,
  mapPopRow,
  getBuildingById,
  getBuildingMapped,
  listBuildingOlts,
  listPopOlts,
  getBuildingOltById,
  getPopOltById,
  createBuildingOlt,
  createPopOlt,
  updateBuildingOlt,
  updatePopOlt,
  deleteBuildingOlt,
  deletePopOlt,
  listProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  listAgencies,
  getAgencyById,
  createAgency,
  updateAgency,
  listCustomersByAgency,
  listCustomers,
  getCustomerById,
  getCustomerContext,
  updateCustomerSubscriptionStatus,
  recordCustomerLastPayment,
  setCustomerLastPaymentFromZoho,
  updateCustomerTispSync,
  reconcileTispSyncStatus,
  updateCustomerZohoBillingStatus,
  reconcileZohoBillingStatus,
  allocateZohoInvoiceSequence,
  recordSignupInvoiceDelivery,
  createCustomer,
  changeCustomerProduct,
  updateCustomerBillingCycle,
  changeCustomerPaymentFrequency,
  findProductForBillingFrequency,
  switchCustomerApartment,
  cancelCustomer,
  disconnectCustomer,
  pauseCustomer,
  markPauseCreditApplied,
  updateCustomerOltMapping,
  clearCustomerOnuMapping,
  deleteCustomerCompletely,
  updateCustomerDetails,
  revertCustomerIpAddress,
  convertCustomerType,
  findActiveTenantInApartment,
  assertApartmentAvailable,
  inspectApartmentForMove,
  apartmentHasHistory,
  findLastIpForApartment,
  getApartmentHistory,
  listApartmentHistory,
  listApartments,
  getApartment,
  getCustomerEvents,
  findCustomerByNumber,
  resolveCustomerByPaybillRef,
  findCustomerByApartmentNumber,
  findCustomerByIp,
  findCustomerByDstvSerial,
  assertDstvSerialUnique,
  releaseCancelledIdentityForReuse,
  archiveCancelledCustomerNumber,
  archiveCancelledCustomerIdentity,
  liveCustomerNumber,
  findMostRecentCancelledTenantIdForNumber,
  findArchivedCancelledTenantIdForNumber,
  assertImportNotDuplicate,
  registerImportBatchEntry,
  importCustomerFromRow,
  getSubscriberStats,
};
