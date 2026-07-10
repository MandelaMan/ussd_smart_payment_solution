import { useCallback, useState } from "react";
import type { SortDirection, SortSpec } from "../lib/tableSort";
import { sortQueryParams } from "../lib/tableSort";

const MAX_SORTS = 3;

export function useTableSort<T extends string>(
  defaultSort: SortSpec<T> | SortSpec<T>[]
) {
  const [sorts, setSorts] = useState<SortSpec<T>[]>(() =>
    Array.isArray(defaultSort) ? defaultSort : [defaultSort]
  );

  const toggleSort = useCallback(
    (column: T, columnDefaultDir: SortDirection = "asc", additive = false) => {
      setSorts((current) => {
        const existingIndex = current.findIndex((sort) => sort.sortBy === column);

        if (additive) {
          if (existingIndex >= 0) {
            const next = [...current];
            next[existingIndex] = {
              sortBy: column,
              sortDir:
                current[existingIndex].sortDir === "asc" ? "desc" : "asc",
            };
            return next;
          }
          if (current.length >= MAX_SORTS) return current;
          return [...current, { sortBy: column, sortDir: columnDefaultDir }];
        }

        if (existingIndex === 0 && current.length === 1) {
          return [
            {
              sortBy: column,
              sortDir: current[0].sortDir === "asc" ? "desc" : "asc",
            },
          ];
        }

        return [{ sortBy: column, sortDir: columnDefaultDir }];
      });
    },
    []
  );

  const primary = sorts[0];

  return {
    sorts,
    sortBy: primary?.sortBy,
    sortDir: primary?.sortDir,
    toggleSort,
    sortQuery: sortQueryParams(sorts),
  };
}
