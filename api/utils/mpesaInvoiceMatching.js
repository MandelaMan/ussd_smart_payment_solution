/** Pure helpers for matching M-Pesa payments to open Zoho invoices. */

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function isUnpaidLikeInvoice(inv) {
  const s = String(inv?.status || "").toLowerCase();
  return ["sent", "overdue", "partially_paid", "unpaid", "draft"].includes(s);
}

function invoiceOrderRef(inv) {
  return String(
    inv?.order_number ||
      inv?.salesorder_number ||
      inv?.reference_number ||
      ""
  )
    .trim()
    .toUpperCase();
}

function invoiceOutstandingBalance(inv) {
  const balance = Number(inv?.balance);
  if (Number.isFinite(balance) && balance >= 0) return roundMoney(balance);
  const total = Number(inv?.total);
  if (Number.isFinite(total) && total >= 0) return roundMoney(total);
  return 0;
}

function amountsEqual(a, b) {
  return Math.abs(roundMoney(a) - roundMoney(b)) < 0.01;
}

function invoiceBalanceMatchesPayment(inv, paymentAmount) {
  const bal = invoiceOutstandingBalance(inv);
  return bal > 0 && amountsEqual(bal, paymentAmount);
}

function invoiceMatchesCustomerRef(inv, customerNumber) {
  const ref = String(customerNumber || "").trim().toUpperCase();
  if (!ref) return false;

  const orderRef = invoiceOrderRef(inv);
  if (orderRef === ref || orderRef.includes(ref)) return true;

  const invoiceNum = String(inv?.invoice_number || "").trim().toUpperCase();
  if (invoiceNum.includes(ref)) return true;

  const referenceNum = String(inv?.reference_number || "").trim().toUpperCase();
  if (referenceNum === ref || referenceNum.includes(ref)) return true;

  return false;
}

function sortInvoicesOldestFirst(list) {
  return [...list].sort((a, b) => {
    const da = new Date(a?.date || a?.created_time || 0).getTime();
    const db = new Date(b?.date || b?.created_time || 0).getTime();
    return da - db;
  });
}

/**
 * Find an open invoice to apply an M-Pesa payment to.
 * Falls back to creating a new invoice when no suitable match exists.
 */
function findTargetOpenInvoice(invoices, customerNumber, paymentAmount) {
  const list = (Array.isArray(invoices) ? invoices : []).filter(isUnpaidLikeInvoice);
  if (!list.length) return null;

  const normalizedRef = String(customerNumber || "").trim().toUpperCase();
  if (normalizedRef) {
    const byRef = list.find((inv) => invoiceMatchesCustomerRef(inv, normalizedRef));
    if (byRef) return byRef;
  }

  const byBalance = list.find((inv) => invoiceBalanceMatchesPayment(inv, paymentAmount));
  if (byBalance) return byBalance;

  if (list.length === 1) return list[0];

  const openWithBalance = sortInvoicesOldestFirst(
    list.filter((inv) => invoiceOutstandingBalance(inv) > 0)
  );
  if (openWithBalance.length === 1) return openWithBalance[0];

  const pay = roundMoney(paymentAmount);
  const fullPayCandidate = openWithBalance.find(
    (inv) => invoiceOutstandingBalance(inv) <= pay
  );
  if (fullPayCandidate) return fullPayCandidate;

  return null;
}

module.exports = {
  roundMoney,
  isUnpaidLikeInvoice,
  invoiceOrderRef,
  invoiceOutstandingBalance,
  amountsEqual,
  invoiceBalanceMatchesPayment,
  invoiceMatchesCustomerRef,
  findTargetOpenInvoice,
};
