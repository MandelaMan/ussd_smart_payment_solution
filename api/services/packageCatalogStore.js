const { query } = require("../config/db");

const PRODUCT_NAME_SEPARATOR = " - ";
const DSTV_ONLY_CATEGORY_CODE = "dstv_only";
const DSTV_ONLY_PRODUCT_NAME = "DSTV Only";

function isDstvOnlyCategory(codeOrName) {
  const raw = String(codeOrName || "").trim().toLowerCase();
  return (
    raw === DSTV_ONLY_CATEGORY_CODE ||
    raw === "dstv only" ||
    raw === "dstv_only"
  );
}

function buildProductName(categoryName, planName, categoryCode = null) {
  if (isDstvOnlyCategory(categoryCode) || isDstvOnlyCategory(categoryName)) {
    return DSTV_ONLY_PRODUCT_NAME;
  }
  return `${planName}${PRODUCT_NAME_SEPARATOR}${categoryName}`;
}

async function listPackageCatalog() {
  const categories = await query(
    `SELECT id, code, name,
            has_apartonet AS hasApartonet,
            has_dstv AS hasDstv,
            requires_decoder_fee AS requiresDecoderFee,
            decoder_fee_amount AS decoderFeeAmount,
            sort_order AS sortOrder
     FROM package_categories
     ORDER BY sort_order, id`
  );

  const plans = await query(
    `SELECT id, category_id AS categoryId, code, name, sort_order AS sortOrder
     FROM package_plans
     ORDER BY sort_order, id`
  );

  const variants = await query(
    `SELECT id, plan_id AS planId,
            payment_frequency AS paymentFrequency,
            default_mbps AS defaultMbps
     FROM package_plan_variants
     ORDER BY FIELD(payment_frequency, 'monthly', 'quarterly', 'yearly')`
  );

  const plansByCategory = new Map();
  for (const plan of plans) {
    if (!plansByCategory.has(plan.categoryId)) {
      plansByCategory.set(plan.categoryId, []);
    }
    plansByCategory.get(plan.categoryId).push({
      ...plan,
      variants: variants.filter((v) => v.planId === plan.id),
    });
  }

  return categories.map((category) => {
    const dstvOnly = isDstvOnlyCategory(category.code);
    let categoryPlans = (plansByCategory.get(category.id) || []).map((plan) => ({
      ...plan,
      name: dstvOnly ? DSTV_ONLY_PRODUCT_NAME : plan.name,
      variants: (plan.variants || []).map((v) => ({
        ...v,
        defaultMbps: dstvOnly ? 0 : Number(v.defaultMbps),
      })),
    }));
    // DSTV Only is a single package (no Basic / Basic Plus tiers).
    if (dstvOnly && categoryPlans.length > 1) {
      const preferred =
        categoryPlans.find((p) => p.code === DSTV_ONLY_CATEGORY_CODE) ||
        categoryPlans[0];
      categoryPlans = [
        {
          ...preferred,
          name: DSTV_ONLY_PRODUCT_NAME,
          code: DSTV_ONLY_CATEGORY_CODE,
        },
      ];
    }
    return {
      ...category,
      requiresDecoderFee: Boolean(category.requiresDecoderFee),
      hasApartonet: Boolean(category.hasApartonet),
      hasDstv: Boolean(category.hasDstv),
      decoderFeeAmount:
        category.decoderFeeAmount != null
          ? Number(category.decoderFeeAmount)
          : null,
      isDstvOnly: dstvOnly,
      plans: categoryPlans,
    };
  });
}

async function getPlanVariantDetails(planVariantId) {
  const rows = await query(
    `SELECT v.id, v.payment_frequency AS paymentFrequency,
            v.default_mbps AS defaultMbps,
            pl.id AS planId, pl.code AS planCode, pl.name AS planName,
            c.id AS categoryId, c.code AS categoryCode, c.name AS categoryName,
            c.has_apartonet AS hasApartonet, c.has_dstv AS hasDstv,
            c.requires_decoder_fee AS requiresDecoderFee,
            c.decoder_fee_amount AS decoderFeeAmount
     FROM package_plan_variants v
     JOIN package_plans pl ON pl.id = v.plan_id
     JOIN package_categories c ON c.id = pl.category_id
     WHERE v.id = ?
     LIMIT 1`,
    [planVariantId]
  );
  const row = rows[0];
  if (!row) return null;
  const dstvOnly = isDstvOnlyCategory(row.categoryCode);
  return {
    ...row,
    hasApartonet: Boolean(row.hasApartonet),
    hasDstv: Boolean(row.hasDstv),
    requiresDecoderFee: Boolean(row.requiresDecoderFee),
    decoderFeeAmount:
      row.decoderFeeAmount != null ? Number(row.decoderFeeAmount) : null,
    isDstvOnly: dstvOnly,
    // DSTV Only has no bandwidth — keep catalog default at 0 for UI/create.
    defaultMbps: dstvOnly ? 0 : Number(row.defaultMbps),
    planName: dstvOnly ? DSTV_ONLY_PRODUCT_NAME : row.planName,
    displayName: buildProductName(
      row.categoryName,
      row.planName,
      row.categoryCode
    ),
  };
}

async function getMonthlyProductPriceForPlan(buildingId, planId) {
  const rows = await query(
    `SELECT p.price
     FROM products p
     JOIN package_plan_variants v ON v.id = p.plan_variant_id
     WHERE p.building_id = ? AND v.plan_id = ? AND v.payment_frequency = 'monthly'
     LIMIT 1`,
    [buildingId, planId]
  );
  return rows[0] ? Number(rows[0].price) : null;
}

module.exports = {
  PRODUCT_NAME_SEPARATOR,
  DSTV_ONLY_CATEGORY_CODE,
  DSTV_ONLY_PRODUCT_NAME,
  isDstvOnlyCategory,
  buildProductName,
  listPackageCatalog,
  getPlanVariantDetails,
  getMonthlyProductPriceForPlan,
};
