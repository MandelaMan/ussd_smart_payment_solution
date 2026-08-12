/** Pure helpers for applying an M-Pesa amount to a Zoho invoice balance. */

const { roundMoney, amountsEqual } = require("./mpesaInvoiceMatching");

/**
 * Decide how much of a payment applies to an open invoice and whether there
 * is excess credit left over.
 */
function planInvoicePayment(paymentAmount, invoiceBalance) {
  const pay = roundMoney(paymentAmount);
  const balance = roundMoney(invoiceBalance);

  if (balance <= 0) {
    return {
      payment_amount: pay,
      amount_applied: pay,
      outcome: "paid_in_full",
      excess_amount: 0,
    };
  }
  if (amountsEqual(pay, balance)) {
    return {
      payment_amount: pay,
      amount_applied: balance,
      outcome: "paid_in_full",
      excess_amount: 0,
    };
  }
  if (pay < balance) {
    return {
      payment_amount: pay,
      amount_applied: pay,
      outcome: "partially_paid",
      excess_amount: 0,
      remaining_balance: roundMoney(balance - pay),
    };
  }
  return {
    payment_amount: pay,
    amount_applied: balance,
    outcome: "paid_with_excess_credit",
    excess_amount: roundMoney(pay - balance),
  };
}

module.exports = {
  planInvoicePayment,
};
