import { useLayoutEffect, type RefObject } from "react";

/**
 * Publishes an element's height as a CSS variable on :root for stacked sticky
 * list-page chrome (title + filters) and table header offset.
 *
 * @param overlapPx Subtract from measured height so the sticky table header
 *   tucks slightly under the chrome (closes the peek seam on scroll).
 */
export function useStickySectionHeight(
  cssVar: string,
  ref: RefObject<HTMLElement | null>,
  enabled = true,
  overlapPx = 0
) {
  useLayoutEffect(() => {
    const root = document.documentElement;

    if (!enabled) {
      root.style.setProperty(cssVar, "0px");
      return;
    }

    const el = ref.current;
    if (!el) return;

    const update = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      const next = Math.max(0, height - overlapPx);
      root.style.setProperty(cssVar, `${next}px`);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      root.style.setProperty(cssVar, "0px");
    };
  }, [cssVar, enabled, overlapPx, ref]);
}
