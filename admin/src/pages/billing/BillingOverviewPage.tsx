import { BillingModuleShell } from "../../components/billing/BillingModuleShell";
import { BillingReconciliationOverview } from "../../components/billing/BillingReconciliationOverview";
import { useBillingReconciliation } from "../../components/billing/BillingReconciliationContext";
import { useAuth } from "../../lib/auth";
import { BILLING_MODULES, moduleCount } from "../../lib/billingReconciliationNav";
import { canOperateFinance } from "../../lib/rbac";

export function BillingOverviewPage() {
  const { user } = useAuth();
  const { summary, summaryLoading, syncing, runSync } = useBillingReconciliation();

  const totalIssues = BILLING_MODULES.reduce(
    (sum, module) => sum + moduleCount(summary, module),
    0,
  );

  return (
    <BillingModuleShell
      title="Billing Reconciliation"
      description="Customers matched to Zoho Books"
      summary={summary}
      syncing={syncing}
      onSync={runSync}
      allowSync={canOperateFinance(user)}
      count={totalIssues > 0 ? totalIssues : undefined}
    >
      <BillingReconciliationOverview summary={summary} summaryLoading={summaryLoading} />
    </BillingModuleShell>
  );
}
