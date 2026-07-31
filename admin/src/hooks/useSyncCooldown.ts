import { useCallback, useEffect, useState } from "react";

export const SYNC_COOLDOWN_MS = 30_000;

const storageKey = (customerId: number) => `customer-sync-until:${customerId}`;

export function getSyncCooldownRemainingMs(customerId: number): number {
  if (typeof sessionStorage === "undefined") return 0;
  const until = Number(sessionStorage.getItem(storageKey(customerId)) || 0);
  return Math.max(0, until - Date.now());
}

export function startSyncCooldown(
  customerId: number,
  durationMs: number = SYNC_COOLDOWN_MS
) {
  const ms = Math.max(0, Number(durationMs) || SYNC_COOLDOWN_MS);
  sessionStorage.setItem(storageKey(customerId), String(Date.now() + ms));
}

/** Parse "Try again in N seconds" (and similar) from API cooldown errors. */
export function parseRetryAfterSeconds(message: string): number | null {
  const match = String(message || "").match(/(\d+)\s*seconds?/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function useSyncCooldown(customerId: number) {
  const [remainingMs, setRemainingMs] = useState(() =>
    getSyncCooldownRemainingMs(customerId)
  );

  useEffect(() => {
    setRemainingMs(getSyncCooldownRemainingMs(customerId));
    const interval = window.setInterval(() => {
      setRemainingMs(getSyncCooldownRemainingMs(customerId));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [customerId]);

  const startCooldown = useCallback(
    (durationMs: number = SYNC_COOLDOWN_MS) => {
      startSyncCooldown(customerId, durationMs);
      setRemainingMs(Math.max(0, Number(durationMs) || SYNC_COOLDOWN_MS));
    },
    [customerId]
  );

  const inCooldown = remainingMs > 0;
  const remainingSeconds = Math.ceil(remainingMs / 1000);

  return { inCooldown, remainingSeconds, remainingMs, startCooldown };
}
