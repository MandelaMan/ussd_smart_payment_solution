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

function generatePppoePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
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

function buildCustomerNumber(building, customerType, apartmentNumber) {
  const code =
    customerType === "B2B" ? building.b2b_code : building.c2b_code;
  return `${code}-${String(apartmentNumber).trim().toUpperCase()}`;
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
    ipAddress: row.ip_address,
    isVatExempt: Boolean(row.is_vat_exempt),
    customerType: row.customer_type,
    apartmentNumber: row.apartment_number,
    paymentFrequency: row.payment_frequency,
    customPeriodDays: row.custom_period_days,
    buildingId: row.building_id,
    buildingName: row.building_name,
    productId: row.product_id,
    productName: row.product_name,
    productMbps: row.product_mbps,
    productExtraBandwidth: row.product_extra_bandwidth,
    planId: row.plan_id != null ? Number(row.plan_id) : null,
    planName: row.plan_name || null,
    planSortOrder: row.plan_sort_order != null ? Number(row.plan_sort_order) : null,
    agencyId: row.agency_id,
    agencyName: row.agency_name,
    agencyEmail: row.agency_email || null,
    agencyPhone: row.agency_phone || null,
    customerNumber: row.customer_number,
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
    lastPaymentDate: row.last_payment_date
      ? String(row.last_payment_date).slice(0, 10)
      : null,
    tispDueDate: row.tisp_due_date ? String(row.tisp_due_date) : null,
    status: row.status,
    upgradePaymentStatus: row.upgrade_payment_status || "none",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const LAST_PAYMENT_SORT_EXPR = `COALESCE(c.last_payment_date, '1000-01-01')`;

const CUSTOMER_SELECT = `
  SELECT c.*,
         b.name AS building_name,
         b.dstv_setup AS building_dstv_setup,
         p.name AS product_name,
         p.mbps AS product_mbps,
         p.extra_bandwidth AS product_extra_bandwidth,
         p.has_dstv AS product_has_dstv,
         pl.id AS plan_id,
         pl.name AS plan_name,
         pl.sort_order AS plan_sort_order,
         a.name AS agency_name,
         a.email AS agency_email,
         a.phone AS agency_phone,
         a.contact_person AS agency_contact_person,
         ts.due_date AS tisp_due_date
  FROM customers c
  JOIN buildings b ON b.id = c.building_id
  JOIN products p ON p.id = c.product_id
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
    clauses.push("(name LIKE ? OR c2b_code LIKE ? OR b2b_code LIKE ?)");
    params.push(q, q, q);
  }
  if (filters.ipSetup) {
    clauses.push("ip_setup = ?");
    params.push(filters.ipSetup);
  }

  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
  const offset = (page - 1) * limit;

  const { resolveListSort } = require("../utils/listSort");
  const sort = resolveListSort(filters, {
    allowed: [
      { key: "name", sql: "name" },
      { key: "c2bCode", sql: "c2b_code" },
      { key: "b2bCode", sql: "b2b_code" },
      { key: "ipSetup", sql: "ip_setup" },
      { key: "createdAt", sql: "created_at" },
    ],
    defaultSort: { sortBy: "name", sortDir: "asc" },
  });

  const [countRow] = await query(
    `SELECT COUNT(*) AS total FROM buildings WHERE ${clauses.join(" AND ")}`,
    params
  );

  const rows = await query(
    `SELECT id, name, c2b_code, b2b_code, ip_setup, dstv_setup, ip_prefixes, created_at
     FROM buildings WHERE ${clauses.join(" AND ")}
     ORDER BY ${sort.orderClause} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const buildings = rows.map(mapBuildingRow);
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

function mapBuildingRow(row) {
  return {
    id: row.id,
    name: row.name,
    c2bCode: row.c2b_code,
    b2bCode: row.b2b_code,
    ipSetup: row.ip_setup,
    dstvSetup: row.dstv_setup || "decoder",
    ipPrefixes: parseBuildingPrefixes(row.ip_prefixes),
    createdAt: row.created_at,
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

async function createBuilding(data) {
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
    if (!ipPrefixes.length) {
      throw new Error("STATIC buildings require at least one IP prefix (e.g. 10.12.10.)");
    }
  }

  const result = await query(
    `INSERT INTO buildings (name, c2b_code, b2b_code, ip_setup, dstv_setup, ip_prefixes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, c2bCode, b2bCode, ipSetup, dstvSetup, JSON.stringify(ipPrefixes)]
  );

  return result.insertId;
}

async function updateBuilding(id, data) {
  const { normalizeIpPrefixes } = require("../config/buildingIpRules");
  const existing = await getBuildingById(id);
  if (!existing) throw new Error("Building not found");

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
      // Empty array on edit means "unchanged" — keep existing prefixes.
      if (normalized.length > 0) {
        ipPrefixes = normalized;
      }
    }
  } else if (ipSetup === "PPOE") {
    ipPrefixes = [];
  }

  await query(
    `UPDATE buildings SET name = ?, c2b_code = ?, b2b_code = ?, ip_setup = ?, dstv_setup = ?, ip_prefixes = ?
     WHERE id = ?`,
    [name, c2bCode, b2bCode, ipSetup, dstvSetup, JSON.stringify(ipPrefixes), id]
  );
}

async function getBuildingById(id) {
  const rows = await query(`SELECT * FROM buildings WHERE id = ? LIMIT 1`, [
    id,
  ]);
  return rows[0] || null;
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
         c.decoder_fee_amount AS decoderFeeAmount
  FROM products p
  JOIN buildings b ON b.id = p.building_id
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
    `SELECT p.*, b.name AS building_name, b.c2b_code, b.b2b_code, b.ip_setup,
            pl.id AS plan_id, pl.name AS plan_name, pl.sort_order AS plan_sort_order
     FROM products p
     JOIN buildings b ON b.id = p.building_id
     LEFT JOIN package_plan_variants v ON v.id = p.plan_variant_id
     LEFT JOIN package_plans pl ON pl.id = v.plan_id
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
  const resolvedMbps = mbps != null ? Number(mbps) : Number(variant.defaultMbps);
  if (!Number.isFinite(resolvedMbps) || resolvedMbps <= 0) {
    throw new Error("Bandwidth (Mbps) must be greater than 0");
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
      Math.max(0, Number(extraBandwidth) || 0),
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

  if (data.planVariantId != null) {
    const variant = await catalogStore.getPlanVariantDetails(
      Number(data.planVariantId)
    );
    if (!variant) throw new Error("Invalid plan variant");
    fields.push(
      "plan_variant_id = ?",
      "name = ?",
      "mbps = ?",
      "payment_frequency = ?",
      "has_dstv = ?"
    );
    params.push(
      variant.id,
      variant.displayName,
      variant.defaultMbps,
      variant.paymentFrequency,
      variant.hasDstv ? 1 : 0
    );
  }

  const allowed = {
    mbps: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error("Bandwidth (Mbps) must be greater than 0");
      }
      return n;
    },
    price: (v) => Number(v),
    monthly_price: (v) => Number(v),
    extra_bandwidth: (v) => Math.max(0, Number(v) || 0),
    is_active: (v) => (v ? 1 : 0),
    name: (v) => String(v).trim(),
    payment_frequency: (v) => v,
    has_dstv: (v) => (v ? 1 : 0),
  };

  for (const [key, transform] of Object.entries(allowed)) {
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const src = data[camel] ?? data[key];
    if (src !== undefined) {
      fields.push(`${key} = ?`);
      params.push(transform(src));
    }
  }

  const nextPrice =
    data.price !== undefined ? Number(data.price) : Number(existing.price);
  await assertUniquePriceInBuilding(existing.building_id, nextPrice, id);

  if (!fields.length) throw new Error("No changes to save");
  params.push(id);
  await query(`UPDATE products SET ${fields.join(", ")} WHERE id = ?`, params);
  return getProductListRow(id);
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
            a.created_at AS createdAt,
            COUNT(DISTINCT CASE WHEN c.status = 'active' THEN c.id END) AS activeCustomers
     FROM agencies a
     LEFT JOIN customers c ON c.agency_id = a.id
     WHERE ${clauses.join(" AND ")}
     GROUP BY a.id, a.name, a.email, a.phone, a.contact_person, a.created_at
     ORDER BY ${sort.orderClause} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  for (const agency of agencies) {
    agency.activeCustomers = Number(agency.activeCustomers || 0);
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

async function getAgencyById(id) {
  const rows = await query(
    `SELECT id, name, email, phone, contact_person AS contactPerson, created_at AS createdAt
     FROM agencies WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function createAgency(data) {
  const { name, email, phone, contactPerson } = data;
  const result = await query(
    `INSERT INTO agencies (name, email, phone, contact_person) VALUES (?, ?, ?, ?)`,
    [
      String(name).trim(),
      String(email).trim().toLowerCase(),
      String(phone).trim(),
      contactPerson ? String(contactPerson).trim() : null,
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

  if (!name || !email || !phone) {
    throw new Error("Name, email, and phone are required");
  }

  await query(
    `UPDATE agencies SET name = ?, email = ?, phone = ?, contact_person = ? WHERE id = ?`,
    [name, email, phone, contactPerson, id]
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
    `SELECT c.*, b.name AS building_name, b.c2b_code, b.b2b_code, b.ip_setup, b.dstv_setup,
            p.name AS product_name, p.mbps AS product_mbps,
            p.extra_bandwidth AS product_extra_bandwidth,
            p.has_dstv AS product_has_dstv,
            pl.id AS plan_id, pl.name AS plan_name, pl.sort_order AS plan_sort_order,
            cat.name AS category_name,
            a.name AS agency_name, a.email AS agency_email,
            a.phone AS agency_phone, a.contact_person AS agency_contact_person
     FROM customers c
     JOIN buildings b ON b.id = c.building_id
     JOIN products p ON p.id = c.product_id
     LEFT JOIN agencies a ON a.id = c.agency_id
     LEFT JOIN package_plan_variants v ON v.id = p.plan_variant_id
     LEFT JOIN package_plans pl ON pl.id = v.plan_id
     LEFT JOIN package_categories cat ON cat.id = pl.category_id
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

  const existing = await findCustomerByDstvSerial(normalized);
  if (!existing) return;
  if (excludeCustomerId && Number(existing.id) === Number(excludeCustomerId)) return;

  const name = [existing.first_name, existing.middle_name, existing.last_name]
    .filter(Boolean)
    .join(" ");
  throw new Error(
    `DSTV decoder serial is already assigned to ${name} (${existing.customer_number})`
  );
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

  const apartmentNumber = String(data.apartmentNumber).trim().toUpperCase();
  await assertApartmentAvailable(building.id, apartmentNumber);

  const customerNumber = buildCustomerNumber(
    building,
    data.customerType,
    apartmentNumber
  );

  const tispPassword =
    building.ip_setup === "STATIC"
      ? apartmentNumber
      : generatePppoePassword();

  const packagePrice = resolvePackagePrice(
    product,
    data.paymentFrequency,
    data.customPeriodDays ?? data.customPeriodMonths
  );

  let decoderFeeRequired = 0;
  let decoderFeeAmount = null;
  if (product.plan_variant_id) {
    const variant = await catalogStore.getPlanVariantDetails(
      product.plan_variant_id
    );
    if (variant?.requiresDecoderFee) {
      decoderFeeRequired = 1;
      decoderFeeAmount = variant.decoderFeeAmount;
    }
  }

  const freqForProduct =
    data.paymentFrequency === "custom" ? "monthly" : data.paymentFrequency;
  if (product.payment_frequency !== freqForProduct && data.paymentFrequency !== "custom") {
    throw new Error("Selected product does not match payment frequency");
  }

  const dstvDecoderSerial = normalizeDstvDecoderSerial(data.dstvDecoderSerial);
  assertDstvDecoderSerial(product, building, dstvDecoderSerial);
  await assertDstvSerialUnique(dstvDecoderSerial);

  const trialPeriodEnabled = Boolean(data.trialPeriod);
  const trialEndsAt = trialPeriodEnabled ? computeTrialEndDate() : null;

  const result = await query(
    `INSERT INTO customers (
       first_name, middle_name, last_name, phone, email, ip_address,
       is_vat_exempt, customer_type, apartment_number, payment_frequency,
       custom_period_days, building_id, product_id, agency_id,
       customer_number, tisp_password, package_price,
       decoder_fee_amount, decoder_fee_required, dstv_decoder_serial,
       trial_period_enabled, trial_ends_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      names.first_name,
      names.middle_name,
      names.last_name,
      String(phone),
      email,
      resolvedIp,
      data.isVatExempt ? 1 : 0,
      data.customerType,
      apartmentNumber,
      data.paymentFrequency,
      data.paymentFrequency === "custom"
        ? Number(data.customPeriodDays ?? data.customPeriodMonths)
        : null,
      building.id,
      product.id,
      data.agencyId || null,
      customerNumber,
      tispPassword,
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

  await query(`UPDATE customers SET product_id = ?, package_price = ? WHERE id = ?`, [
    newProductId,
    packagePrice,
    customerId,
  ]);

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
      const ipTaken = await findCustomerByIp(ipCheck.ip);
      if (ipTaken && Number(ipTaken.id) !== Number(customerId)) {
        throw new Error("IP address is already assigned");
      }
    }
    resolvedIp = ipCheck.ip;
  }

  const newCustomerNumber = buildCustomerNumber(
    building,
    customer.customer_type,
    newApartment
  );
  const previousCustomerNumber = customer.customer_number;

  const tispPassword =
    building.ip_setup === "STATIC" ? newApartment : generatePppoePassword();

  const previousIp = customer.ip_address || null;

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
     SET apartment_number = ?, customer_number = ?, tisp_password = ?, ip_address = ?
     WHERE id = ?`,
    [newApartment, newCustomerNumber, tispPassword, resolvedIp, customerId]
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

async function cancelCustomer(customerId, notes) {
  const customer = await getCustomerContext(customerId);
  if (!customer) throw new Error("Customer not found");
  if (customer.status === "cancelled") {
    throw new Error("Customer is already cancelled");
  }

  await query(`UPDATE customers SET status = 'cancelled' WHERE id = ?`, [
    customerId,
  ]);

  await query(
    `UPDATE apartment_history
     SET moved_out_at = NOW(),
         reason = 'cancel',
         ip_address = COALESCE(NULLIF(TRIM(ip_address), ''), ?)
     WHERE customer_id = ? AND moved_out_at IS NULL`,
    [customer.ip_address || null, customerId]
  );

  await query(
    `INSERT INTO customer_events (customer_id, event_type, old_apartment, notes)
     VALUES (?, 'cancel', ?, ?)`,
    [customerId, customer.apartment_number, notes || "Subscription cancelled"]
  );

  return customer;
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
  const agencyId =
    customerType === "B2B" && data.agencyId ? Number(data.agencyId) : null;

  if (!firstName || !lastName) {
    throw new Error("First name and last name are required");
  }
  if (!["C2B", "B2B"].includes(customerType)) {
    throw new Error("Customer type must be C2B or B2B");
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
  if (ipCheck.ip && ipCheck.ip !== existing.ipAddress) {
    const ipTaken = await findCustomerByIp(ipCheck.ip);
    if (ipTaken && ipTaken.id !== id) {
      throw new Error("IP address is already assigned");
    }
  }

  const fullName = [firstName, middleName, lastName].filter(Boolean).join(" ");

  let productId = existing.productId;
  let paymentFrequency = existing.paymentFrequency;
  let customPeriodDays = existing.customPeriodDays;
  let packagePrice = existing.packagePrice;
  let packageChanged = false;

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
    packageChanged =
      productId !== existing.productId ||
      paymentFrequency !== existing.paymentFrequency ||
      customPeriodDays !== existing.customPeriodDays;
  }

  const effectiveProduct = await getProductById(productId);
  if (!effectiveProduct) throw new Error("Product not found");

  const dstvDecoderSerial =
    data.dstvDecoderSerial !== undefined
      ? normalizeDstvDecoderSerial(data.dstvDecoderSerial)
      : existing.dstvDecoderSerial;
  assertDstvDecoderSerial(effectiveProduct, building, dstvDecoderSerial);
  await assertDstvSerialUnique(dstvDecoderSerial, id);

  const contactChanged =
    firstName !== existing.firstName ||
    lastName !== existing.lastName ||
    (middleName || null) !== (existing.middleName || null) ||
    phone !== existing.phone ||
    email !== (existing.email || "");

  await query(
    `UPDATE customers
     SET first_name = ?, middle_name = ?, last_name = ?, phone = ?, email = ?,
         is_vat_exempt = ?, customer_type = ?, agency_id = ?, ip_address = ?,
         dstv_decoder_serial = ?,
         product_id = ?, payment_frequency = ?, custom_period_days = ?, package_price = ?
     WHERE id = ?`,
    [
      firstName,
      middleName,
      lastName,
      phone,
      email,
      data.isVatExempt ? 1 : 0,
      customerType,
      agencyId,
      ipCheck.ip,
      dstvDecoderSerial,
      productId,
      paymentFrequency,
      customPeriodDays,
      packagePrice,
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

  await query(
    `UPDATE apartment_history
     SET customer_name = ?
     WHERE customer_id = ? AND moved_out_at IS NULL`,
    [fullName, id]
  );

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
  return {
    customer,
    contactChanged,
    packageChanged,
    apartmentChanged,
    previousCustomerNumber,
  };
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
    customer.apartment_number
  );

  const [existing] = await query(
    `SELECT id FROM customers WHERE customer_number = ? AND id <> ? LIMIT 1`,
    [newCustomerNumber, customerId]
  );
  if (existing) {
    throw new Error(`Customer number ${newCustomerNumber} is already in use`);
  }

  const oldNumber = customer.customer_number;
  const agencyName =
    resolvedAgencyId != null
      ? (await getAgencyById(resolvedAgencyId))?.name || null
      : null;

  await query(
    `UPDATE customers SET customer_type = ?, agency_id = ?, customer_number = ? WHERE id = ?`,
    [nextType, resolvedAgencyId, newCustomerNumber, customerId]
  );

  await query(
    `UPDATE apartment_history SET customer_number = ?
     WHERE customer_id = ? AND moved_out_at IS NULL`,
    [newCustomerNumber, customerId]
  );

  await query(
    `INSERT INTO customer_events (customer_id, event_type, notes)
     VALUES (?, 'type_change', ?)`,
    [
      customerId,
      `Converted from ${currentType} to ${nextType}${
        agencyName ? ` · agency: ${agencyName}` : ""
      } · ${oldNumber} → ${newCustomerNumber}`,
    ]
  );

  return {
    customer: await getCustomerById(customerId),
    previousType: currentType,
    newType: nextType,
    previousCustomerNumber: oldNumber,
    newCustomerNumber,
    agencyId: resolvedAgencyId,
    agencyName,
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
            ) AS ipAddress
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
            ) AS ipAddress
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
    `SELECT * FROM buildings WHERE LOWER(name) = LOWER(?) LIMIT 1`,
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
    throw new Error(`Customer number already exists: ${normalizedNumber}`);
  }

  if (ipAddress) {
    const existingByIp = await findCustomerByIp(ipAddress);
    if (existingByIp) {
      throw new Error(
        `IP address ${ipAddress} is already assigned to ${existingByIp.customer_number}`
      );
    }
  }

  if (normalizedDstvSerial) {
    const existingByDstv = await findCustomerByDstvSerial(normalizedDstvSerial);
    if (existingByDstv) {
      throw new Error(
        `DSTV decoder serial ${normalizedDstvSerial} is already assigned to ${existingByDstv.customer_number}`
      );
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
  if (!row.phone || !row.apartment_number || !row.building_name || !row.product_name) {
    throw new Error("phone, apartment_number, building_name, and product_name are required");
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

  const apartmentNumber = String(row.apartment_number).trim().toUpperCase();
  const customerNumber = buildCustomerNumber(building, customerType, apartmentNumber);

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
    apartmentNumber: row.apartment_number,
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
    [tispService],
  ] = await Promise.all([
    query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
        SUM(CASE WHEN customer_type = 'C2B' THEN 1 ELSE 0 END) AS c2b_count,
        SUM(CASE WHEN customer_type = 'B2B' THEN 1 ELSE 0 END) AS b2b_count,
        SUM(CASE WHEN tisp_sync_status = 'failed' THEN 1 ELSE 0 END) AS tisp_failed,
        SUM(CASE WHEN tisp_sync_status = 'pending' THEN 1 ELSE 0 END) AS tisp_pending
      FROM customers
    `),
    query(
      `SELECT COUNT(*) AS count FROM customers
       WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
      [days]
    ),
    query(`SELECT COUNT(*) AS count FROM buildings`),
    query(`SELECT COUNT(*) AS count FROM agencies`),
    query(`
      SELECT b.name AS building, COUNT(*) AS subscribers
      FROM customers c
      JOIN buildings b ON b.id = c.building_id
      WHERE c.status = 'active'
        AND LOWER(TRIM(COALESCE(c.subscription_status, ''))) = 'active'
      GROUP BY b.id, b.name
      ORDER BY subscribers DESC
      LIMIT 20
    `),
    query(`
      SELECT p.name AS package_name, p.mbps, COUNT(*) AS subscribers
      FROM customers c
      JOIN products p ON p.id = c.product_id
      WHERE c.status = 'active'
        AND LOWER(TRIM(COALESCE(c.subscription_status, ''))) = 'active'
      GROUP BY p.id, p.name, p.mbps
      ORDER BY subscribers DESC
      LIMIT 8
    `),
    query(`
      SELECT
        SUM(CASE WHEN LOWER(TRIM(COALESCE(c.subscription_status, ''))) = 'active' THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN LOWER(COALESCE(c.subscription_status, '')) LIKE '%suspend%' THEN 1 ELSE 0 END) AS suspended_count,
        SUM(CASE
          WHEN LOWER(COALESCE(c.subscription_status, '')) LIKE '%cancel%' THEN 0
          WHEN c.subscription_status IS NULL
            OR TRIM(c.subscription_status) = ''
            OR LOWER(TRIM(c.subscription_status)) IN ('unknown', 'not on tisp', 'not_on_tisp')
            OR (
              LOWER(TRIM(c.subscription_status)) <> 'active'
              AND LOWER(c.subscription_status) NOT LIKE '%suspend%'
            )
          THEN 1 ELSE 0 END) AS unknown_count
      FROM customers c
      WHERE c.status = 'active'
    `),
  ]);

  return {
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
    // Heavy lifetime payment JOINs removed — unused by the dashboard UI.
    avgCustomerPayment: 0,
    avgPaymentsPerCustomer: 0,
    tispActive: Number(tispService?.active_count || 0),
    tispSuspended: Number(tispService?.suspended_count || 0),
    tispUnknown: Number(tispService?.unknown_count || 0),
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
            b.c2b_code AS c2bCode,
            b.b2b_code AS b2bCode,
            b.ip_setup AS ipSetup,
            b.dstv_setup AS dstvSetup,
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
  listBuildings,
  createBuilding,
  updateBuilding,
  mapBuildingRow,
  getBuildingById,
  listProducts,
  getProductById,
  createProduct,
  updateProduct,
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
  deleteCustomerCompletely,
  updateCustomerDetails,
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
  findCustomerByIp,
  findCustomerByDstvSerial,
  assertDstvSerialUnique,
  assertImportNotDuplicate,
  registerImportBatchEntry,
  importCustomerFromRow,
  getSubscriberStats,
};
