/**
 * Standard TISP billing due date used for create/update defaults across the app.
 * Format: YYYY-MM-DD (2 August 2026).
 * Override with TISP_STANDARD_DUE_DATE in .env when the cycle date changes.
 */
const TISP_STANDARD_DUE_DATE = String(
  process.env.TISP_STANDARD_DUE_DATE || "2026-08-02"
).trim();

/**
 * TISP SetClientDetails BillingCycle — always Monthly on INSERT and UPDATE.
 * Dashboard payment frequency (yearly/quarterly/custom) must never change this.
 */
const TISP_BILLING_CYCLE = "Monthly";

/**
 * TISP rejects blank StaticIPAddress ("StaticIPAddress Missing.").
 * When freeing an old account before INSERT, park it here so the real IP can
 * be claimed by the new AccountNumber.
 */
const TISP_RELEASE_PLACEHOLDER_IP = "0.0.0.0";

/**
 * PPOE buildings have no assigned static IP. TISP still requires StaticIPAddress,
 * so every PPOE client uses this shared placeholder. PppoeRemoteAddress stays blank.
 */
const TISP_PPOE_PLACEHOLDER_STATIC_IP = "10.2.2.2";

function isTispPlaceholderIp(ip) {
  const value = String(ip || "").trim();
  return (
    value === TISP_RELEASE_PLACEHOLDER_IP ||
    value === TISP_PPOE_PLACEHOLDER_STATIC_IP
  );
}

module.exports = {
  TISP_STANDARD_DUE_DATE,
  TISP_BILLING_CYCLE,
  TISP_RELEASE_PLACEHOLDER_IP,
  TISP_PPOE_PLACEHOLDER_STATIC_IP,
  isTispPlaceholderIp,
};
