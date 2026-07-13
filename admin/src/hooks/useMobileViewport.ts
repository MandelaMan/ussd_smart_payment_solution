import { useBreakpointValue } from "@chakra-ui/react";

/** True below the `lg` breakpoint (mobile list layout). */
export function useMobileViewport() {
  return useBreakpointValue({ base: true, lg: false }, { ssr: false }) ?? false;
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
