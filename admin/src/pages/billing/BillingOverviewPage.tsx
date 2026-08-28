import { BillingModuleShell } from "../../components/billing/BillingModuleShell";
import { BillingReconciliationOverview } from "../../components/billing/BillingReconciliationOverview";
import { useBillingReconciliation } from "../../components/billing/BillingReconciliationContext";
import { useAuth } from "../../lib/authContext";
import { canOperateFinance } from "../../lib/rbac";

export function BillingOverviewPage() {
  const { user } = useAuth();
  const { summary, summaryLoading, syncing, runSync } = useBillingReconciliation();

  const uniqueIssues = summary?.sync.issueCustomerCount ?? 0;

  return (
    <BillingModuleShell
      title="Billing Reconciliation"
      summary={summary}
      syncing={syncing}
      onSync={runSync}
      allowSync={canOperateFinance(user)}
      count={uniqueIssues > 0 ? uniqueIssues : undefined}
    >
      <BillingReconciliationOverview summary={summary} summaryLoading={summaryLoading} />
    </BillingModuleShell>
  );
}
