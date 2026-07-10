const customerStore = require("../customerModuleStore");
const customerRepo = require("../../repositories/customer.repository");

/**
 * CRM / customer data access for sync workers.
 */
async function mapCustomerRow(row) {
  return customerStore.getCustomerById(row.id);
}

async function listCustomersForSync(options = {}) {
  const rows = await customerRepo.listCustomersPage(options);
  const customers = [];
  for (const row of rows) {
    const customer = await customerStore.getCustomerById(row.id);
    if (customer) customers.push(customer);
  }
  return customers;
}

module.exports = {
  listCustomersForSync,
  mapCustomerRow,
};
