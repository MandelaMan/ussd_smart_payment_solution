import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type ReconciliationSummary } from "../../lib/api";
import { toaster } from "../ui/toaster";
import { useBillingSync } from "./useBillingSync";

type BillingContextValue = {
  summary: ReconciliationSummary | null;
  summaryLoading: boolean;
  reloadKey: number;
  syncing: boolean;
  runSync: () => Promise<boolean>;
  refreshSummary: (opts?: { silent?: boolean }) => Promise<void>;
  bumpReload: () => void;
};

const BillingReconciliationContext = createContext<BillingContextValue | null>(null);

export function BillingReconciliationProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState<ReconciliationSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const syncStatusRef = useRef<string | null>(null);
  const lastProcessedRef = useRef(0);

  const refreshSummary = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setSummaryLoading(true);
    try {
      setSummary(await api.getReconciliationSummary({ cached: true }));
    } catch (e) {
      if (!opts?.silent) {
        toaster.error({
          title: "Failed to load summary",
          description: e instanceof Error ? e.message : "Unknown error",
        });
      }
    } finally {
      if (!opts?.silent) setSummaryLoading(false);
    }
  }, []);

  const bumpReload = useCallback(() => setReloadKey((k) => k + 1), []);

  const { syncing, runSync } = useBillingSync(async () => {
    await refreshSummary();
    bumpReload();
  });

  useEffect(() => {
    refreshSummary();
  }, [refreshSummary]);

  useEffect(() => {
    const status = summary?.sync.status ?? null;
    const processed = summary?.sync.progress?.processed ?? 0;
    if (syncStatusRef.current === "running" && status === "completed") {
      bumpReload();
    } else if (status === "running" && processed > lastProcessedRef.current) {
      bumpReload();
    }
    lastProcessedRef.current = status === "running" ? processed : 0;
    syncStatusRef.current = status;
  }, [summary?.sync.status, summary?.sync.progress?.processed, bumpReload]);

  useEffect(() => {
    if (summary?.sync.status !== "running") return;

    let cancelled = false;
    const id = window.setInterval(() => {
      if (!cancelled) {
        refreshSummary({ silent: true });
      }
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [summary?.sync.status, refreshSummary]);

  return (
    <BillingReconciliationContext.Provider
      value={{
        summary,
        summaryLoading,
        reloadKey,
        syncing,
        runSync,
        refreshSummary,
        bumpReload,
      }}
    >
      {children}
    </BillingReconciliationContext.Provider>
  );
}

export function useBillingReconciliation() {
  const ctx = useContext(BillingReconciliationContext);
  if (!ctx) {
    throw new Error("useBillingReconciliation must be used within BillingReconciliationProvider");
  }
  return ctx;
}
