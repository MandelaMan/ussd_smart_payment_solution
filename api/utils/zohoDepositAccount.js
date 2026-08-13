/**
 * Resolve the Zoho Books "Deposited To" account for a customer payment.
 * M-Pesa must land on the paybill bank account, not the Paystack Funds default.
 */

const DEFAULT_MPESA_DEPOSIT_ACCOUNT_NAME = "MPESA PAYBILL NO 4185091";
const DEFAULT_MPESA_PAYBILL = "4185091";

function normalizeAccountName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function accountLabel(account) {
  return normalizeAccountName(
    account?.account_name || account?.account_name_formatted || ""
  );
}

function isPaystackFundsAccount(account) {
  const name = accountLabel(account);
  return name.includes("paystack");
}

function accountNameMatches(account, { exactName, paybillNumber } = {}) {
  const name = accountLabel(account);
  if (!name || isPaystackFundsAccount(account)) return false;

  if (exactName && name === normalizeAccountName(exactName)) return true;

  const digits = String(paybillNumber || "").replace(/\D/g, "");
  if (digits && name.includes(digits) && /mpesa|m-pesa|paybill/.test(name)) {
    return true;
  }
  return false;
}

function pickDepositAccountId(accounts, options = {}) {
  const configuredId = String(options.accountId || "").trim();
  if (configuredId) return configuredId;

  const list = Array.isArray(accounts) ? accounts : [];
  const exact = list.find((account) =>
    accountNameMatches(account, { exactName: options.accountName })
  );
  if (exact?.account_id) return String(exact.account_id);

  const fuzzy = list.find((account) =>
    accountNameMatches(account, { paybillNumber: options.paybillNumber })
  );
  return fuzzy?.account_id ? String(fuzzy.account_id) : null;
}

function mpesaDepositLookupOptions(env = process.env) {
  return {
    accountId: String(env.ZOHO_MPESA_ACCOUNT_ID || "").trim(),
    accountName:
      String(env.ZOHO_MPESA_DEPOSIT_ACCOUNT_NAME || "").trim() ||
      DEFAULT_MPESA_DEPOSIT_ACCOUNT_NAME,
    paybillNumber:
      String(env.ZOHO_MPESA_PAYBILL || "").trim() || DEFAULT_MPESA_PAYBILL,
  };
}

function isMpesaPaymentChannel(channelLabel) {
  return /m-?pesa/i.test(String(channelLabel || ""));
}

module.exports = {
  DEFAULT_MPESA_DEPOSIT_ACCOUNT_NAME,
  DEFAULT_MPESA_PAYBILL,
  normalizeAccountName,
  accountNameMatches,
  pickDepositAccountId,
  mpesaDepositLookupOptions,
  isMpesaPaymentChannel,
};
