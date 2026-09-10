/**
 * App-wide reachability.
 *
 * "offline" = the browser reports no network (Wi‑Fi / mobile data).
 * "unreachable" = the browser is online but SUL Bix's API did not respond
 *   (local server down, proxy refused, etc.). Never call that "no internet".
 */

export const CONNECTIVITY_RESTORED_EVENT = "sul:connectivity-restored";

export const CONNECTIVITY_ERROR_MESSAGE =
  "Can't reach SUL Bix. Check your internet connection.";

export const SERVER_UNREACHABLE_MESSAGE =
  "Can't reach SUL Bix. The server isn't responding.";

export const REQUEST_TIMEOUT_MESSAGE =
  "The request took too long. Please try again.";

const PROBE_TIMEOUT_MS = 5_000;
const POLL_WHILE_OFFLINE_MS = 8_000;

export type ConnectivityStatus = "ok" | "offline" | "unreachable";

export type ConnectivityState = {
  status: ConnectivityStatus;
  checking: boolean;
};

type ReachabilityFailureReason = "network" | "timeout";

const listeners = new Set<(state: ConnectivityState) => void>();

let state: ConnectivityState = {
  status: typeof navigator === "undefined" || navigator.onLine ? "ok" : "offline",
  checking: false,
};

let started = false;
let pollId: number | undefined;
let probeInFlight = false;

function emit() {
  for (const listener of listeners) listener(state);
}

function setState(next: Partial<ConnectivityState>) {
  const merged = { ...state, ...next };
  if (merged.status === state.status && merged.checking === state.checking) return;
  state = merged;
  emit();
}

function browserReportsOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function startPolling() {
  if (typeof window === "undefined" || pollId != null) return;
  pollId = window.setInterval(() => {
    void confirmOnline({ userInitiated: false });
  }, POLL_WHILE_OFFLINE_MS);
}

function stopPolling() {
  if (pollId == null) return;
  window.clearInterval(pollId);
  pollId = undefined;
}

function markOffline() {
  setState({ status: "offline", checking: false });
  startPolling();
}

function markUnreachable() {
  setState({ status: "unreachable", checking: false });
  startPolling();
}

function markOk() {
  const wasDisconnected = state.status !== "ok";
  stopPolling();
  setState({ status: "ok", checking: false });
  if (wasDisconnected && typeof window !== "undefined") {
    window.dispatchEvent(new Event(CONNECTIVITY_RESTORED_EVENT));
  }
}

async function probeReachability(): Promise<boolean> {
  if (typeof window === "undefined") return true;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/?_cb=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export function getConnectivityState(): ConnectivityState {
  return state;
}

export function subscribeConnectivity(listener: (state: ConnectivityState) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function confirmOnline(
  options: { userInitiated?: boolean } = {}
): Promise<boolean> {
  if (probeInFlight) return state.status === "ok";
  probeInFlight = true;
  if (options.userInitiated) setState({ checking: true });
  try {
    const ok = await probeReachability();
    if (ok) {
      markOk();
      return true;
    }
    if (browserReportsOnline()) markUnreachable();
    else markOffline();
    return false;
  } finally {
    probeInFlight = false;
    if (state.checking) setState({ checking: false });
  }
}

/** Called from the API client when a request never reached the server. */
export function reportReachabilityFailure(reason: ReachabilityFailureReason) {
  if (!browserReportsOnline()) {
    markOffline();
    return;
  }
  if (reason === "network") {
    markUnreachable();
    return;
  }
  void confirmOnline({ userInitiated: false });
}

export function isBrowserNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network request failed") ||
    message.includes("load failed") ||
    message.includes("err_internet_disconnected") ||
    message.includes("err_network_changed") ||
    message.includes("err_connection_refused")
  );
}

export function isConnectivityErrorMessage(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const message = value.toLowerCase();
  return (
    message.includes("check your internet") ||
    message.includes("can't reach sul bix") ||
    message.includes("cannot reach sul bix") ||
    message.includes("no internet") ||
    message.includes("server isn't responding") ||
    message.includes("request timed out") ||
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network request failed")
  );
}

export function isConnectivityError(err: unknown): boolean {
  if (isBrowserNetworkFailure(err)) return true;
  if (err instanceof Error && isConnectivityErrorMessage(err.message)) return true;
  if (typeof err === "object" && err && "status" in err) {
    const status = Number((err as { status: unknown }).status);
    if (status === 0 || status === 408) return true;
  }
  return false;
}

export function startConnectivityMonitor() {
  if (started || typeof window === "undefined") return;
  started = true;

  window.addEventListener("offline", () => {
    markOffline();
  });
  window.addEventListener("online", () => {
    void confirmOnline({ userInitiated: false });
  });

  if (!navigator.onLine) markOffline();
}
