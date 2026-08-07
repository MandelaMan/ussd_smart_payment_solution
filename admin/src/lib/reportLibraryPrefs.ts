const FAV_KEY = "sul-report-favorites";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getFavoriteReportIds(): string[] {
  return readJson<string[]>(FAV_KEY, []);
}

export function toggleFavoriteReport(id: string): string[] {
  const set = new Set(getFavoriteReportIds());
  if (set.has(id)) set.delete(id);
  else set.add(id);
  const next = [...set];
  localStorage.setItem(FAV_KEY, JSON.stringify(next));
  return next;
}
