/**
 * iOS/Android PWAs report 100dvh larger than the visible screen when the
 * status bar is translucent, so the shell (and bottom nav) sit off-screen
 * with a dead strip below. Pin --app-height to the visual viewport.
 */
export function lockAppViewport() {
  const root = document.documentElement;

  const apply = () => {
    const vv = window.visualViewport;
    const height = Math.max(1, Math.round(vv?.height ?? window.innerHeight));
    root.style.setProperty("--app-height", `${height}px`);
  };

  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
  window.visualViewport?.addEventListener("resize", apply);

  return () => {
    window.removeEventListener("resize", apply);
    window.removeEventListener("orientationchange", apply);
    window.visualViewport?.removeEventListener("resize", apply);
  };
}
