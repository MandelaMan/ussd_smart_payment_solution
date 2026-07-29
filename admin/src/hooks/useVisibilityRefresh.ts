import { useEffect, useRef } from "react";

/**
 * Soft-refresh page data when the user returns to this tab.
 * Does not run on first mount and never shows a blocking spinner —
 * the caller should pass a silent reload.
 */
export function useVisibilityRefresh(onRefresh: () => void) {
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

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(readyTimer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
