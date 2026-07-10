/**
 * Resolve safe ORDER BY for paginated list endpoints.
 * Supports comma-separated sortBy / sortDir for multi-column sorting.
 * @param {object} filters - request query / filter bag
 * @param {{ allowed: Array<{ key: string, sql: string }>, defaultSort: { sortBy: string, sortDir?: 'asc'|'desc' }, defaultOrderClause?: string, maxSorts?: number }} config
 */
function resolveListSort(filters, { allowed, defaultSort, defaultOrderClause, maxSorts = 3 }) {
  const allowedMap = new Map(allowed.map((entry) => [entry.key, entry]));
  const fallback =
    allowedMap.get(defaultSort.sortBy) || allowed[0];

  const defaultDir =
    String(defaultSort.sortDir || "desc").toLowerCase() === "asc"
      ? "ASC"
      : "DESC";

  const requestedKeys = String(filters.sortBy || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const requestedDirs = String(filters.sortDir || "")
    .split(",")
    .map((part) => part.trim().toLowerCase());

  const clauses = [];
  for (let index = 0; index < Math.min(requestedKeys.length, maxSorts); index++) {
    const key = requestedKeys[index];
    const entry = allowedMap.get(key);
    if (!entry) continue;
    const dir = requestedDirs[index] === "asc" ? "ASC" : "DESC";
    clauses.push(`${entry.sql} ${dir}`);
  }

  if (clauses.length === 0) {
    if (defaultOrderClause) {
      return {
        sortBy: defaultSort.sortBy,
        sortDir: defaultDir === "ASC" ? "asc" : "desc",
        orderClause: defaultOrderClause,
      };
    }
    return {
      sortBy: fallback.key,
      sortDir: defaultDir === "ASC" ? "asc" : "desc",
      orderClause: `${fallback.sql} ${defaultDir}`,
    };
  }

  return {
    sortBy: requestedKeys.slice(0, clauses.length).join(","),
    sortDir: clauses
      .map((_, index) => (requestedDirs[index] === "asc" ? "asc" : "desc"))
      .join(","),
    orderClause: clauses.join(", "),
  };
}

module.exports = { resolveListSort };
