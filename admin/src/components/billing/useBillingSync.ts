import { useCallback, useState } from "react";
import { api } from "../../lib/api";
import { toaster } from "../ui/toaster";

export function useBillingSync(onComplete?: () => void) {
  const [syncing, setSyncing] = useState(false);

  const runSync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await api.runReconciliationSync(true);
      if (!result.ok) {
        toaster.error({ title: result.error || "Sync failed" });
        return false;
      }
      if (result.queued) {
        toaster.success({
          title: "Sync started",
          description: result.message || "Reconciliation is running in the background",
        });
        onComplete?.();
        return true;
      }
      toaster.success({
        title: "Sync completed",
        description: `${result.customersScanned} customers · ${result.issuesFound} issues`,
      });
      onComplete?.();
      return true;
    } catch (e) {
      toaster.error({
        title: "Sync failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
      return false;
    } finally {
      setSyncing(false);
    }
  }, [onComplete]);

  return { syncing, runSync };
}
