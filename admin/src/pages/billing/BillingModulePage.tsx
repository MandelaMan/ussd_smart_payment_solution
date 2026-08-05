import { Text } from "@chakra-ui/react";
import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { BillingCustomerTable } from "../../components/billing/BillingCustomerTable";
import { BillingModuleShell } from "../../components/billing/BillingModuleShell";
import { useBillingReconciliation } from "../../components/billing/BillingReconciliationContext";
import { toaster } from "../../components/ui/toaster";
import { api } from "../../lib/api";
import {
  getBillingModuleFromPath,
  moduleCount,
  moduleStatusParam,
} from "../../lib/billingReconciliationNav";
import { useAuth } from "../../lib/authContext";
import { canOperateFinance } from "../../lib/rbac";

type Column =
  | "issue"
  | "issueType"
  | "outstanding"
  | "service"
  | "frequency"
  | "lastInvoice"
  | "lastPayment"
  | "tispDue"
  | "action";

const MODULE_COLUMNS: Record<string, Column[]> = {
  "billing-gaps": [
    "issueType",
    "frequency",
    "lastInvoice",
    "lastPayment",
    "tispDue",
    "outstanding",
    "issue",
    "action",
  ],
  "manual-review": ["issue", "action"],
};

export function BillingModulePage() {
  const location = useLocation();
  const { user } = useAuth();
  const allowSync = canOperateFinance(user);
  const module = getBillingModuleFromPath(location.pathname);
  const { summary, syncing, runSync, reloadKey } = useBillingReconciliation();
  const [exporting, setExporting] = useState(false);

  if (!module || module.mpesaTable) {
    return <Navigate to="/billing" replace />;
  }

  const count = moduleCount(summary, module);
  const columns = MODULE_COLUMNS[module.id] ?? ["issue", "outstanding", "action"];

  async function handleExport() {
    const status = moduleStatusParam(module!);
    if (!status) return;
    setExporting(true);
    try {
      await api.exportReconciliation({ status });
    } catch (e) {
      toaster.error({
        title: "Export failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <BillingModuleShell
      title={module.label}
      summary={summary}
      syncing={syncing}
      exporting={exporting}
      onSync={runSync}
      allowSync={allowSync}
      onExport={handleExport}
      count={count}
      hideSyncBanner
    >
      {module.id === "billing-gaps" && (
        <Text fontSize="xs" color="fg.muted" mb={1} display={{ base: "none", lg: "block" }}>
          Browse is limited to 10 local records to protect Zoho API limits. Search a customer to
          live-check Zoho invoices, payments, and TISP connection — mismatches are flagged; “No gaps”
          confirms they are up to date.
        </Text>
      )}
      <BillingCustomerTable
        module={module}
        columns={columns}
        reloadKey={reloadKey}
        showInvoiceAmountUnderCustomer={module.id === "billing-gaps"}
      />
    </BillingModuleShell>
  );
}
