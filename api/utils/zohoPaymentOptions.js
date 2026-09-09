/**
 * Zoho Books Payment Options checkbox ("Paystack") on invoices and
 * recurring invoices. Maps to payment_options.payment_gateways.
 */

function parseGatewayNames(value) {
  const raw =
    value != null && String(value).trim()
      ? String(value)
      : process.env.ZOHO_RECURRING_PAYMENT_GATEWAYS || "paystack";
  return [
    ...new Set(
      raw
        .split(/[,;\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

function isPaystackGateway(gateway) {
  return String(gateway?.gateway_name || "").trim().toLowerCase() === "paystack";
}

function withRequiredPaymentGateways(
  payload = {},
  existingPaymentOptions = null,
  gatewayNames = parseGatewayNames()
) {
  const existing = [
    ...(existingPaymentOptions?.payment_gateways || []),
    ...(payload.payment_options?.payment_gateways || []),
  ];
  const byName = new Map();
  for (const gateway of existing) {
    const name = String(gateway?.gateway_name || "").trim();
    if (!name) continue;
    byName.set(name.toLowerCase(), {
      ...gateway,
      gateway_name: name,
      configured: gateway.configured !== false,
    });
  }
  for (const name of gatewayNames) {
    const current = byName.get(name);
    byName.set(name, {
      ...(current || {}),
      gateway_name: current?.gateway_name || name,
      configured: true,
    });
  }
  return {
    ...payload,
    payment_options: {
      payment_gateways: [...byName.values()],
    },
  };
}

function looksLikePaymentGatewayError(error) {
  const msg = String(
    error?.response?.data?.message || error?.message || ""
  ).toLowerCase();
  const code = Number(error?.response?.data?.code);
  return (
    msg.includes("payment_options") ||
    msg.includes("payment gateway") ||
    msg.includes("gateway_name") ||
    (code === 2 && msg.includes("gateway"))
  );
}

function withoutPaymentOptions(payload) {
  if (!payload || !payload.payment_options) return payload;
  const { payment_options, ...rest } = payload;
  return rest;
}

function invoiceHasPaystackPaymentOption(invoice) {
  const gateways = invoice?.payment_options?.payment_gateways || [];
  return gateways.some((g) => isPaystackGateway(g) && g.configured !== false);
}

module.exports = {
  parseGatewayNames,
  isPaystackGateway,
  withRequiredPaymentGateways,
  looksLikePaymentGatewayError,
  withoutPaymentOptions,
  invoiceHasPaystackPaymentOption,
};
