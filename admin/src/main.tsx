import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

/**
 * Stale PWAs were auto-reloading mid-session and re-applying an old cached
 * shell (white band + raised bottom nav). Bust SW/caches before first paint,
 * and never force a mid-session reload on update.
 */
async function prepareServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  const hadController = Boolean(navigator.serviceWorker.controller);
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((reg) => reg.unregister()));

  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }

  // One reload releases an active controller that was still serving old CSS.
  if (
    import.meta.env.DEV &&
    hadController &&
    !sessionStorage.getItem("sul-sw-bust")
  ) {
    sessionStorage.setItem("sul-sw-bust", "1");
    window.location.reload();
    return "reload";
  }

  if (import.meta.env.PROD) {
    const { registerSW } = await import("virtual:pwa-register");
    registerSW({
      immediate: true,
      // Do not call updateSW() here — auto mid-session reload was restoring
      // stale mobile-nav CSS (white band + raised pill).
      onNeedRefresh() {
        /* update applies on the next cold visit after caches expire */
      },
    });
  }

  return "ok";
}

async function boot() {
  const sw = await prepareServiceWorker();
  if (sw === "reload") return;

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void boot();
