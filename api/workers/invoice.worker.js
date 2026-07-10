const { INTEGRATIONS } = require("../queue/definitions");
const { createZohoModuleProcessor } = require("./zohoModule.worker");

const INTEGRATION = INTEGRATIONS.INVOICE;
const processInvoiceSyncJob = createZohoModuleProcessor(INTEGRATION);

module.exports = { processInvoiceSyncJob, INTEGRATION };
