import { Outlet } from "react-router-dom";
import { BillingReconciliationProvider } from "../../components/billing/BillingReconciliationContext";

export function BillingReconciliationLayout() {
  return (
    <BillingReconciliationProvider>
      <Outlet />
    </BillingReconciliationProvider>
  );
}
