import { BillingCommunicationsTable } from "../../components/billing/BillingCommunicationsTable";
import { BillingModuleShell } from "../../components/billing/BillingModuleShell";
import { useBillingReconciliation } from "../../components/billing/BillingReconciliationContext";
import { useAuth } from "../../lib/auth";
import { BILLING_COMMUNICATIONS_MODULE, moduleCount } from "../../lib/billingReconciliationNav";
import { canOperateFinance } from "../../lib/rbac";

export function BillingCommunicationsPage() {
  const { user } = useAuth();
  const { summary, syncing, runSync, reloadKey, bumpReload } = useBillingReconciliation();
  const count = moduleCount(summary, BILLING_COMMUNICATIONS_MODULE);
  const mailConfigured = summary?.mailConfig?.configured ?? false;

  return (
    <BillingModuleShell
      title={BILLING_COMMUNICATIONS_MODULE.label}
      description={BILLING_COMMUNICATIONS_MODULE.description}
      summary={summary}
      syncing={syncing}
      onSync={runSync}
      allowSync={canOperateFinance(user)}
      count={count > 0 ? count : undefined}
    >
      <BillingCommunicationsTable
        reloadKey={reloadKey}
        onReload={bumpReload}
        mailConfigured={mailConfigured}
      />
    </BillingModuleShell>
  );
}
