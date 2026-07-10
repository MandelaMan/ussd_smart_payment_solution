import { useEffect, useState } from "react";

/** Returns `value` after it stops changing for `delayMs` (default 350ms). */
export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

/** Debounced search query with a pending flag while the input is still settling. */
export function useDebouncedSearch(input: string, delayMs = 350) {
  const debounced = useDebouncedValue(input, delayMs);
  const query = debounced.trim();
  const pending = input.trim() !== query;
  return { query, pending };
}
