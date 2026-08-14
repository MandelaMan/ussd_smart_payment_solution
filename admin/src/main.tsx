import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { ensureFreshAdminShell } from "./lib/ensureFreshAdminShell";
import { lockAppViewport } from "./lib/lockAppViewport";

/**
 * In development, clear any leftover production service workers so Vite HMR
 * is never blocked by a cached /admin shell.
 *
 * Production updates are handled by AppUpdateBanner (prompt → reload) plus
 * ensureFreshAdminShell() which busts caches when the build id changes.
 */
async function prepareServiceWorker() {
  if (!("serviceWorker" in navigator)) return "ok";

  if (!import.meta.env.DEV) return "ok";

  const hadController = Boolean(navigator.serviceWorker.controller);
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((reg) => reg.unregister()));

  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }

  if (hadController && !sessionStorage.getItem("sul-sw-bust")) {
    sessionStorage.setItem("sul-sw-bust", "1");
    window.location.reload();
    return "reload";
  }

  return "ok";
}

async function boot() {
  lockAppViewport();

  const buildId =
    import.meta.env.VITE_ADMIN_BUILD_ID ||
    import.meta.env.VITE_APP_VERSION ||
    // Hashed entry URL changes every production build — good bust token.
    String(import.meta.url);

  const fresh = await ensureFreshAdminShell(buildId);
  if (fresh === "reload") return;

  const sw = await prepareServiceWorker();
  if (sw === "reload") return;

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );

  // Belt-and-suspenders: never leave the HTML splash covering a mounted app
  // after HMR / auth remounts (BootSplashGate also dismisses).
  try {
    const { dismissBootSplash } = await import("./lib/bootSplash");
    // Delay slightly so AuthProvider can start; max-wait still applies for PWA.
    window.setTimeout(() => dismissBootSplash(), 0);
  } catch {
    document.getElementById("sul-boot-splash")?.remove();
  }
}

void boot();
