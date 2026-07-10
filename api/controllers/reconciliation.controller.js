const reconciliationStore = require("../services/reconciliationStore");
const { sendTableExport } = require("../utils/tableExportResponse");
const billingCommunicationStore = require("../services/billingCommunicationStore");
const { BILLING_STATUSES } = require("../utils/reconciliationEngine");

async function getSummary(req, res, next) {
  try {
    const cached = req.query.cached === "true" || req.query.cached === "1";
    const summary = cached
      ? await reconciliationStore.getCachedSummary()
      : await reconciliationStore.getSummary();

    if (cached) {
      reconciliationStore.scheduleBackgroundSyncIfNeeded();
    }

    try {
      const counts = await billingCommunicationStore.countEligible();
      summary.communicationsEligible = counts.eligible;
      summary.communicationsTotal = counts.total;
    } catch {
      summary.communicationsEligible = 0;
      summary.communicationsTotal = 0;
    }
    summary.mailConfig = billingCommunicationStore.getZohoMailConfig();
    res.json(summary);
  } catch (e) {
    next(e);
  }
}

async function getSyncStatus(req, res, next) {
  try {
    res.json(reconciliationStore.getSyncStatus());
  } catch (e) {
    next(e);
  }
}

async function runSync(req, res, next) {
  try {
    const fullZoho = req.body?.fullZoho === true;
    const result = await reconciliationStore.runSync({
      triggeredBy: "manual",
      userId: req.user?.id,
      fullZoho,
    });
    if (!result.ok) {
      return res.status(409).json(result);
    }
    if (result.status === "queued" || result.jobId) {
      return res.status(202).json({
        ok: true,
        queued: true,
        ...result,
        message: "Sync queued — results will update in the background",
      });
    }
    res.json(result);
  } catch (e) {
    next(e);
  }
}

async function listCustomers(req, res, next) {
  try {
    const result = await reconciliationStore.listCustomers({
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
      search: req.query.search,
      buildingId: req.query.buildingId,
      issuesOnly: req.query.issuesOnly,
      sortBy: req.query.sortBy,
      sortDir: req.query.sortDir,
    });
    res.json(result);
  } catch (e) {
    next(e);
  }
}

async function getCustomerDetail(req, res, next) {
  try {
    const refresh = req.query.refresh === "true" || req.query.refresh === "1";
    const detail = await reconciliationStore.getCustomerDetail(req.params.id, {
      refreshTisp: refresh,
      refreshZoho: refresh,
    });
    if (!detail) {
      return res.status(404).json({ error: "Customer not found" });
    }
    res.json(detail);
  } catch (e) {
    next(e);
  }
}

async function listUnmatchedMpesa(req, res, next) {
  try {
    if (!reconciliationStore.getSyncStatus().lastSyncAt) {
      reconciliationStore.scheduleBackgroundSyncIfNeeded();
    }
    res.json({ data: reconciliationStore.getUnmatchedMpesa() });
  } catch (e) {
    next(e);
  }
}

async function getUnmatchedMpesaDetail(req, res, next) {
  try {
    const detail = await reconciliationStore.getUnmatchedMpesaDetail(Number(req.params.id));
    if (!detail) {
      return res.status(404).json({ error: "Payment not found" });
    }
    res.json(detail);
  } catch (e) {
    next(e);
  }
}

async function allocateUnmatchedMpesa(req, res, next) {
  try {
    const result = await reconciliationStore.allocateUnmatchedMpesa(
      Number(req.params.id),
      req.user
    );
    res.json(result);
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ error: e.message });
    if (e.message) return res.status(400).json({ error: e.message });
    next(e);
  }
}

async function executeAction(req, res, next) {
  try {
    const { action, ...payload } = req.body || {};
    if (!action) {
      return res.status(400).json({ error: "action is required" });
    }
    const result = await reconciliationStore.executeAction(
      req.params.id,
      action,
      payload,
      req.user
    );
    res.json(result);
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ error: e.message });
    if (e.message && !e.status) return res.status(400).json({ error: e.message });
    next(e);
  }
}

async function exportReconciliation(req, res, next) {
  try {
    const status = req.query.status || "";
    const format = String(req.query.format || "csv").toLowerCase();
    const scope = String(req.query.scope || "all").toLowerCase();
    const pageNum =
      scope === "view"
        ? Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1)
        : 1;
    const limitNum =
      scope === "view"
        ? Math.min(
            100,
            Math.max(1, parseInt(String(req.query.limit || "25"), 10) || 25)
          )
        : 10000;

    const result = await reconciliationStore.listCustomers({
      page: pageNum,
      limit: limitNum,
      status,
      search: req.query.search,
      forExport: true,
    });

    const headers = [
      { key: "customerNumber", label: "Customer Number" },
      { key: "customerName", label: "Customer Name" },
      { key: "buildingName", label: "Building" },
      { key: "productName", label: "Package" },
      { key: "primaryStatus", label: "Primary Status" },
      { key: "outstandingBalance", label: "Outstanding Balance" },
      { key: "expectedAmount", label: "Expected Amount" },
      { key: "billingFrequency", label: "Billing Frequency" },
      { key: "subscriptionStatus", label: "Service Status" },
      { key: "recommendations", label: "Recommendations" },
    ];

    const report = {
      title: "Billing Reconciliation",
      headers,
      rows: result.data.map((row) => ({
        customerNumber: row.customerNumber,
        customerName: row.customerName,
        buildingName: row.buildingName,
        productName: row.productName,
        primaryStatus: row.primaryStatus,
        outstandingBalance: row.metrics?.outstandingBalance ?? 0,
        expectedAmount: row.metrics?.expectedAmount ?? 0,
        billingFrequency: row.metrics?.billingFrequency ?? "",
        subscriptionStatus: row.metrics?.subscriptionStatus ?? "",
        recommendations: (row.recommendations || []).map((r) => r.label).join("; "),
      })),
    };

    const scopeSuffix = scope === "view" ? "current-view" : "all-records";
    return sendTableExport(
      res,
      report,
      format,
      `billing-reconciliation-${scopeSuffix}`
    );
  } catch (e) {
    next(e);
  }
}

async function listStatuses(req, res, next) {
  try {
    res.json({ statuses: BILLING_STATUSES });
  } catch (e) {
    next(e);
  }
}

async function listCommunications(req, res, next) {
  try {
    if (!reconciliationStore.getSyncStatus().lastSyncAt) {
      await reconciliationStore.runSync({ triggeredBy: "manual", fullZoho: false });
    }
    const result = await billingCommunicationStore.listCandidates({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      status: req.query.status,
      hasEmail: req.query.hasEmail,
    });
    res.json(result);
  } catch (e) {
    next(e);
  }
}

async function previewCommunication(req, res, next) {
  try {
    const preview = await billingCommunicationStore.previewCommunication(
      Number(req.params.customerId),
      req.query.template || undefined
    );
    res.json(preview);
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ error: e.message });
    if (e.message) return res.status(400).json({ error: e.message });
    next(e);
  }
}

async function sendCommunication(req, res, next) {
  try {
    const result = await billingCommunicationStore.sendCommunication(
      Number(req.params.customerId),
      { templateKey: req.body?.templateKey, user: req.user }
    );
    res.json(result);
  } catch (e) {
    if (e.message) return res.status(400).json({ error: e.message });
    next(e);
  }
}

async function sendBulkCommunications(req, res, next) {
  try {
    const result = await billingCommunicationStore.sendBulkCommunication({
      customerIds: req.body?.customerIds || [],
      user: req.user,
    });
    res.json(result);
  } catch (e) {
    if (e.message) return res.status(400).json({ error: e.message });
    next(e);
  }
}

async function getCommunicationTemplates(req, res, next) {
  try {
    res.json({
      templates: billingCommunicationStore.listTemplateOptions(),
      mailConfig: billingCommunicationStore.getZohoMailConfig(),
    });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  getSummary,
  getSyncStatus,
  runSync,
  listCustomers,
  getCustomerDetail,
  listUnmatchedMpesa,
  getUnmatchedMpesaDetail,
  allocateUnmatchedMpesa,
  executeAction,
  exportReconciliation,
  listStatuses,
  listCommunications,
  previewCommunication,
  sendCommunication,
  sendBulkCommunications,
  getCommunicationTemplates,
};
