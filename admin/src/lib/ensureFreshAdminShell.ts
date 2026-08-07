/**
 * Clears stale PWA caches when the deployed admin build changes.
 * Prevents blank screens after deploys when an old service worker keeps a
 * precached shell that references deleted hashed assets.
 *
 * Skipped in Vite DEV — switching between :5173 and :4000 (or HMR) would
 * otherwise fight over build ids and leave a blank / reload loop.
 */
export async function ensureFreshAdminShell(buildId: string) {
  if (typeof window === "undefined") return "ok";
  if (import.meta.env.DEV) return "ok";

  const KEY = "sul-admin-build-id";
  let previous: string | null = null;
  try {
    previous = localStorage.getItem(KEY);
  } catch {
    /* private mode */
  }

  const buildChanged = Boolean(previous && previous !== buildId);

  if (buildChanged && "serviceWorker" in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    } catch {
      /* ignore */
    }
  }

  if (buildChanged && "caches" in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch {
      /* ignore */
    }
  }

  try {
    localStorage.setItem(KEY, buildId);
  } catch {
    /* ignore */
  }

  if (buildChanged && !sessionStorage.getItem("sul-build-bust")) {
    sessionStorage.setItem("sul-build-bust", "1");
    window.location.reload();
    return "reload";
  }

  return "ok";
}
