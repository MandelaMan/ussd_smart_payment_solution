const SPLASH_ID = "sul-boot-splash";
const MIN_VISIBLE_MS = 480;
const MAX_WAIT_MS = 6000;
const FADE_MS = 320;

let bootStartedAt =
  typeof performance !== "undefined" ? performance.now() : Date.now();
let dismissed = false;
let maxWaitTimer: number | null = null;

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** True when running as an installed PWA (not a normal browser tab). */
export function isPwaDisplayMode() {
  if (typeof window === "undefined") return false;
  if (document.documentElement.classList.contains("sul-pwa")) return true;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    // iOS Safari "Add to Home Screen"
    Boolean(
      (window.navigator as Navigator & { standalone?: boolean }).standalone
    )
  );
}

function removeSplash(el: HTMLElement) {
  el.remove();
  document.documentElement.classList.add("sul-booted");
}

function fadeOutSplash(el: HTMLElement) {
  if (el.classList.contains("sul-boot-splash--hide")) return;
  el.classList.add("sul-boot-splash--hide");
  el.setAttribute("aria-hidden", "true");

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    removeSplash(el);
  };

  el.addEventListener("transitionend", finish, { once: true });
  window.setTimeout(finish, FADE_MS + 80);
}

/** Hide the HTML boot splash after first auth resolution (or max wait). */
export function dismissBootSplash() {
  if (dismissed) return;
  dismissed = true;

  if (maxWaitTimer != null) {
    window.clearTimeout(maxWaitTimer);
    maxWaitTimer = null;
  }

  if (!isPwaDisplayMode()) {
    document.getElementById(SPLASH_ID)?.remove();
    document.documentElement.classList.add("sul-booted");
    return;
  }

  const el = document.getElementById(SPLASH_ID);
  if (!el) {
    document.documentElement.classList.add("sul-booted");
    return;
  }

  const remaining = Math.max(0, MIN_VISIBLE_MS - (now() - bootStartedAt));
  window.setTimeout(() => fadeOutSplash(el), remaining);
}

/** Safety net so a hung /me never leaves the splash forever. */
export function armBootSplashMaxWait() {
  if (!isPwaDisplayMode() || maxWaitTimer != null || dismissed) return;
  maxWaitTimer = window.setTimeout(() => {
    maxWaitTimer = null;
    dismissBootSplash();
  }, MAX_WAIT_MS);
}
