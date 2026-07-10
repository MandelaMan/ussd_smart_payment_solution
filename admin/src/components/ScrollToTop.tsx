import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/** Scroll the app's main pane (not window) to top on route changes. */
export function ScrollToTop() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    const main = document.querySelector<HTMLElement>("[data-app-scroll-root]");
    if (main) {
      main.scrollTop = 0;
      main.scrollLeft = 0;
    }
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [pathname, search]);

  return null;
}
