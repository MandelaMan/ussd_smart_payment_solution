const customerRepo = require("../../repositories/customer.repository");

/**
 * Lightweight customer rows for TISP sync workers (id + customer number only).
 * Avoids full getCustomerById joins/subqueries per page.
 */
async function listCustomersForSync(options = {}) {
  const rows = await customerRepo.listCustomersPage(options);
  return rows.map((row) => ({
    id: row.id,
    customerNumber: row.customer_number,
    subscriptionStatus: row.subscription_status,
  }));
}

async function mapCustomerRow(row) {
  return {
    id: row.id,
    customerNumber: row.customer_number,
    subscriptionStatus: row.subscription_status,
  };
}

module.exports = {
  listCustomersForSync,
  mapCustomerRow,
};
