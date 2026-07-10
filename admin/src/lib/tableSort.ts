export type SortDirection = "asc" | "desc";

export type SortSpec<T extends string = string> = {
  sortBy: T;
  sortDir: SortDirection;
};

export function sortQueryParams<T extends string>(sorts: SortSpec<T>[]) {
  return {
    sortBy: sorts.map((sort) => sort.sortBy).join(","),
    sortDir: sorts.map((sort) => sort.sortDir).join(","),
  };
}

function normalizeSortValue(value: unknown): string | number {
  if (value == null) return "";
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  const text = String(value).trim();
  const numeric = Number(text.replace(/[^0-9.-]/g, ""));
  if (text && !Number.isNaN(numeric) && /^\d|ksh/i.test(text)) {
    return numeric;
  }
  return text.toLowerCase();
}

export function compareSortValues(a: unknown, b: unknown): number {
  const left = normalizeSortValue(a);
  const right = normalizeSortValue(b);
  if (left === right) return 0;
  if (left === "" || left == null) return 1;
  if (right === "" || right == null) return -1;
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function sortRows<T, K extends string>(
  rows: T[],
  sorts: SortSpec<K>[],
  accessors: Partial<Record<K, (row: T) => unknown>>
): T[] {
  if (sorts.length === 0) return rows;

  return [...rows].sort((left, right) => {
    for (const { sortBy, sortDir } of sorts) {
      const accessor = accessors[sortBy];
      if (!accessor) continue;
      const compared = compareSortValues(accessor(left), accessor(right));
      if (compared !== 0) {
        return sortDir === "asc" ? compared : -compared;
      }
    }
    return 0;
  });
}
