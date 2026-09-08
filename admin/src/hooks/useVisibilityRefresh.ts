import { useEffect, useRef } from "react";

/** Poll interval for live Home dashboards while the tab is visible. */
export const LIVE_REFRESH_INTERVAL_MS = 15_000;

/**
 * Soft-refresh page data when the user returns to this tab.
 * Optionally polls while the tab stays visible (`intervalMs`).
 * Does not run on first mount and never shows a blocking spinner —
 * the caller should pass a silent reload.
 */
export function useVisibilityRefresh(onRefresh: () => void, intervalMs = 0) {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const readyRef = useRef(false);

  useEffect(() => {
    // Skip the first focus/visibility burst after mount.
    const readyTimer = window.setTimeout(() => {
      readyRef.current = true;
    }, 1500);

    const refresh = () => {
      if (!readyRef.current) return;
      if (document.visibilityState !== "visible") return;
      onRefreshRef.current();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    document.addEventListener("visibilitychange", onVisibility);

    let intervalId: number | undefined;
    if (intervalMs > 0) {
      intervalId = window.setInterval(refresh, intervalMs);
    }

    return () => {
      window.clearTimeout(readyTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      if (intervalId != null) window.clearInterval(intervalId);
    };
  }, [intervalMs]);
}
