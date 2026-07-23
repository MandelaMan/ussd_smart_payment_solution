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

module.exports = {
  TISP_STANDARD_DUE_DATE,
  TISP_BILLING_CYCLE,
};
