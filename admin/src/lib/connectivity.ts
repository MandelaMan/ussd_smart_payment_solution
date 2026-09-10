/**
 * Internet connectivity for the admin UI.
 *
 * The orange banner is tied only to the browser's online/offline signal
 * (`navigator.onLine` + `online`/`offline` events). A failed API call, a
 * nodemon restart, or a refused local proxy is not an internet outage.
 */

export const CONNECTIVITY_RESTORED_EVENT = "sul:connectivity-restored";

export const CONNECTIVITY_ERROR_MESSAGE =
  "Can't reach SUL Bix. Check your internet connection.";

export const SERVER_UNREACHABLE_MESSAGE =
  "Can't reach SUL Bix. The server isn't responding.";

export const REQUEST_TIMEOUT_MESSAGE =
  "The request took too long. Please try again.";

const POLL_WHILE_OFFLINE_MS = 3_000;

export type ConnectivityStatus = "ok" | "offline";

export type ConnectivityState = {
  status: ConnectivityStatus;
  checking: boolean;
};

const listeners = new Set<(state: ConnectivityState) => void>();

let state: ConnectivityState = {
  status: browserReportsOnline() ? "ok" : "offline",
  checking: false,
};

let started = false;
let pollId: number | undefined;

function browserReportsOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function emit() {
  for (const listener of listeners) listener(state);
}

function setState(next: Partial<ConnectivityState>) {
  const merged = { ...state, ...next };
  if (merged.status === state.status && merged.checking === state.checking) return;
  state = merged;
  emit();
}

function startPolling() {
  if (typeof window === "undefined" || pollId != null) return;
  pollId = window.setInterval(() => {
    if (browserReportsOnline()) markOk();
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

function markOk() {
  const wasOffline = state.status === "offline";
  stopPolling();
  setState({ status: "ok", checking: false });
  if (wasOffline && typeof window !== "undefined") {
    window.dispatchEvent(new Event(CONNECTIVITY_RESTORED_EVENT));
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

/** Re-read the browser's network flag (used by Try again). */
export async function confirmOnline(
  options: { userInitiated?: boolean } = {}
): Promise<boolean> {
  if (options.userInitiated) setState({ checking: true });
  await new Promise((r) => window.setTimeout(r, options.userInitiated ? 200 : 0));
  const online = browserReportsOnline();
  if (online) markOk();
  else markOffline();
  return online;
}

/** Any HTTP response (even 4xx/5xx) means the device reached a server. */
export function noteNetworkActivity() {
  markOk();
}

/**
 * API timeouts / failed fetches. Only flips the banner when the browser
 * itself says there is no network.
 */
export function reportReachabilityFailure(_reason?: "network" | "timeout") {
  if (!browserReportsOnline()) markOffline();
}

export function isBrowserNetworkFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  const name = err.name.toLowerCase();
  if (name === "typeerror" && (message === "failed to fetch" || message.includes("fetch"))) {
    return true;
  }
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
    message.includes("no internet") ||
    message.includes("can't reach sul bix") ||
    message.includes("cannot reach sul bix") ||
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
    markOk();
  });

  if (navigator.onLine) markOk();
  else markOffline();
}
