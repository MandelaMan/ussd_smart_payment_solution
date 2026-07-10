const customerRepo = require("../../repositories/customer.repository");

/**
 * Payment data service — primarily local MySQL with optional Zoho enrichment.
 */
async function loadUnmatchedMpesa() {
  const rows = await customerRepo.listUnmatchedMpesaPayments();
  return rows.map((row) => ({
    id: row.id,
    amount: row.amount != null ? Number(row.amount) : null,
    referenceId: row.mpesa_receipt || null,
    phone: row.phone || null,
    accountReference: row.account_reference || null,
    channel: row.channel || null,
    paidAt: row.transaction_date || row.created_at,
    suggestedCustomerNumber: row.account_reference || null,
  }));
}

module.exports = {
  loadUnmatchedMpesa,
};
