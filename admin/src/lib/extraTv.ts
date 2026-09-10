export const EXTRA_TV_UNIT_FEE = 500;
export const MAX_TV_COUNT = 10;

export function packageIncludesTv(
  categoryCode?: string | null,
  hasDstv?: boolean
): boolean {
  const code = String(categoryCode || "").trim().toLowerCase();
  if (code === "internet_only") return false;
  if (code) return true;
  return Boolean(hasDstv);
}

export function normalizeTvCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MAX_TV_COUNT, Math.floor(n));
}

export function extraTvCount(tvCount: unknown): number {
  return Math.max(0, normalizeTvCount(tvCount) - 1);
}

export function extraTvFee(tvCount: unknown): number {
  return extraTvCount(tvCount) * EXTRA_TV_UNIT_FEE;
}
