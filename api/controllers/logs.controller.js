const {
  listApiCallLogs,
  getApiCallLogById,
  incrementRetryCount,
} = require("../services/apiCallLogStore");
const { postSetISPPayment } = require("./tisp.controller");
const {
  syncNewCustomerToTisp,
  pushCustomerToTisp,
} = require("./customers.controller");
const store = require("../services/customerModuleStore");

async function listLogs(req, res, next) {
  try {
    const { service, status, operation, search, from, to, page, limit, sortBy, sortDir } =
      req.query;
    const result = await listApiCallLogs({
      service,
      status,
      operation,
      search,
      from,
      to,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
      sortBy,
      sortDir,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function getLog(req, res, next) {
  try {
    const log = await getApiCallLogById(Number(req.params.id));
    if (!log) {
      return res.status(404).json({ error: "Log entry not found" });
    }
    return res.json({ log });
  } catch (err) {
    return next(err);
  }
}

async function retryLog(req, res, next) {
  try {
    const log = await getApiCallLogById(Number(req.params.id));
    if (!log) {
      return res.status(404).json({ error: "Log entry not found" });
    }
    if (!log.retryable) {
      return res.status(400).json({ error: "This log entry is not retryable" });
    }

    await incrementRetryCount(log.id);
    let result = { ok: false, message: "Unsupported operation" };

    if (
      log.operation === "set_client_create" ||
      log.operation === "set_client_details"
    ) {
      if (!log.customerId) {
        return res
          .status(400)
          .json({ error: "No customer linked to this log entry" });
      }
      const tispError = await syncNewCustomerToTisp(
        log.customerId,
        log.customerNumber,
        { parentLogId: log.id },
      );
      result = tispError
        ? { ok: false, error: tispError }
        : { ok: true, message: "Customer created on TISP" };
    } else if (log.operation === "set_client_update") {
      if (!log.customerId) {
        return res
          .status(400)
          .json({ error: "No customer linked to this log entry" });
      }
      const ctx = await store.getCustomerContext(log.customerId);
      if (!ctx) {
        return res.status(404).json({ error: "Customer not found" });
      }
      await pushCustomerToTisp(ctx, { parentLogId: log.id });
      result = { ok: true, message: "Customer details updated on TISP" };
    } else if (log.operation === "set_isp_payment") {
      const payload = log.requestPayload || {};
      await postSetISPPayment(payload, {
        customerNumber: log.customerNumber,
        referenceId: log.referenceId,
        parentLogId: log.id,
      });
      result = { ok: true, message: "SetISPPayment retried" };
    } else if (
      log.operation === "customer_tisp_push" &&
      log.customerId
    ) {
      const ctx = await store.getCustomerContext(log.customerId);
      if (!ctx) {
        return res.status(404).json({ error: "Customer not found" });
      }
      await pushCustomerToTisp(ctx, { parentLogId: log.id });
      await store.updateCustomerTispSync(log.customerId, "synced", null);
      result = { ok: true, message: "Customer pushed to TISP" };
    } else {
      return res.status(400).json({
        error: `Retry is not supported for operation: ${log.operation}`,
      });
    }

    const updated = await getApiCallLogById(log.id);
    return res.json({ ...result, log: updated });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || "Retry failed",
    });
  }
}

module.exports = {
  listLogs,
  getLog,
  retryLog,
};
