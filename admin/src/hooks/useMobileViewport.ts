import { useEffect, useState } from "react";

/** Matches Chakra `lg` (1024px). True below that breakpoint. */
const MOBILE_LIST_QUERY = "(max-width: 1023px)";

function readMobileViewport() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(MOBILE_LIST_QUERY).matches;
}

/**
 * True below the `lg` breakpoint (mobile list layout).
 * Reads matchMedia on the first client render so the hidden layout is never mounted.
 */
export function useMobileViewport() {
  const [isMobile, setIsMobile] = useState(readMobileViewport);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_LIST_QUERY);
    const onChange = () => setIsMobile(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

/** Append page results on mobile; replace on desktop or page 1. */
export function mergeInfinitePage<T>(
  previous: T[],
  pageData: T[],
  page: number,
  infinite: boolean,
  getKey: (item: T) => string | number
): T[] {
  if (!infinite || page <= 1) return pageData;
  const seen = new Set(previous.map(getKey));
  const appended = pageData.filter((item) => !seen.has(getKey(item)));
  return appended.length > 0 ? [...previous, ...appended] : previous;
}
