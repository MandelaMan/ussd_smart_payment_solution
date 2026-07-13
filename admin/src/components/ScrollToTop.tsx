import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/** Jump the app's main scroll pane (and window) to the top. */
export function scrollAppToTop() {
  const main = document.querySelector<HTMLElement>("[data-app-scroll-root]");
  if (main) {
    main.scrollTo({ top: 0, left: 0, behavior: "auto" });
    main.scrollTop = 0;
    main.scrollLeft = 0;
  }
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

/** Jump the app's main pane to top on route changes (no smooth animation). */
export function ScrollToTop() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    scrollAppToTop();
    // Re-assert after paint in case layout/content shifts the scroll position.
    const raf = window.requestAnimationFrame(() => scrollAppToTop());
    return () => window.cancelAnimationFrame(raf);
  }, [pathname, search]);

  return null;
}
