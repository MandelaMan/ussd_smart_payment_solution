import { BillingModuleShell } from "../../components/billing/BillingModuleShell";
import { BillingReconciliationOverview } from "../../components/billing/BillingReconciliationOverview";
import { useBillingReconciliation } from "../../components/billing/BillingReconciliationContext";
import { BILLING_MODULES, moduleCount } from "../../lib/billingReconciliationNav";

export function BillingOverviewPage() {
  const { summary, summaryLoading, syncing, runSync } = useBillingReconciliation();

  const totalIssues = BILLING_MODULES.reduce(
    (sum, module) => sum + moduleCount(summary, module),
    0,
  );

  return (
    <BillingModuleShell
      title="Billing Reconciliation"
      description="Review billing gaps across Zoho, M-Pesa, and TISP — dashboard customers are matched to Zoho Books (not imported from Zoho)"
      summary={summary}
      syncing={syncing}
      onSync={runSync}
      count={totalIssues > 0 ? totalIssues : undefined}
    >
      <BillingReconciliationOverview summary={summary} summaryLoading={summaryLoading} />
    </BillingModuleShell>
  );
}
