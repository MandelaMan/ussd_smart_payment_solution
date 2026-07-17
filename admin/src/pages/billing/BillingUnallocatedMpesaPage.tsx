import { BillingModuleShell } from "../../components/billing/BillingModuleShell";
import { BillingUnallocatedMpesaTable } from "../../components/billing/BillingUnallocatedMpesaTable";
import { useBillingReconciliation } from "../../components/billing/BillingReconciliationContext";
import { useAuth } from "../../lib/auth";
import { BILLING_MODULES, moduleCount } from "../../lib/billingReconciliationNav";
import { canOperateFinance } from "../../lib/rbac";

const MODULE = BILLING_MODULES.find((m) => m.id === "unallocated-mpesa")!;

export function BillingUnallocatedMpesaPage() {
  const { user } = useAuth();
  const { summary, syncing, runSync, reloadKey, bumpReload } = useBillingReconciliation();
  const count = moduleCount(summary, MODULE);

  return (
    <BillingModuleShell
      title={MODULE.label}
      description={MODULE.description}
      summary={summary}
      syncing={syncing}
      onSync={runSync}
      allowSync={canOperateFinance(user)}
      count={count}
    >
      <BillingUnallocatedMpesaTable reloadKey={reloadKey} onReload={bumpReload} />
    </BillingModuleShell>
  );
}
