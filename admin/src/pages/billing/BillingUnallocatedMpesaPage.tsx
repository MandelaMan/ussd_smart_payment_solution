import { BillingModuleShell } from "../../components/billing/BillingModuleShell";
import { BillingUnallocatedMpesaTable } from "../../components/billing/BillingUnallocatedMpesaTable";
import { useBillingReconciliation } from "../../components/billing/BillingReconciliationContext";
import { BILLING_MODULES, moduleCount } from "../../lib/billingReconciliationNav";

const MODULE = BILLING_MODULES.find((m) => m.id === "unallocated-mpesa")!;

export function BillingUnallocatedMpesaPage() {
  const { summary, syncing, runSync, reloadKey, bumpReload } = useBillingReconciliation();
  const count = moduleCount(summary, MODULE);

  return (
    <BillingModuleShell
      title={MODULE.label}
      description={`${MODULE.description} — expand a payment to review open Zoho invoices and allocate`}
      summary={summary}
      syncing={syncing}
      onSync={runSync}
      count={count}
    >
      <BillingUnallocatedMpesaTable reloadKey={reloadKey} onReload={bumpReload} />
    </BillingModuleShell>
  );
}
