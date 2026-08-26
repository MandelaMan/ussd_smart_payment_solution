/** Away days are exclusive of the return date (pause end). */
export function pauseAwayDays(startDate?: string | null, endDate?: string | null): number {
  if (!startDate || !endDate || endDate < startDate) return 0;
  const start = Date.parse(`${startDate}T00:00:00`);
  const end = Date.parse(`${endDate}T00:00:00`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86400000));
}

export function addCalendarDays(date: string, days: number): string | null {
  if (!date || !Number.isFinite(days)) return date || null;
  const parsed = Date.parse(`${date}T00:00:00`);
  if (Number.isNaN(parsed)) return null;
  const next = new Date(parsed);
  next.setDate(next.getDate() + days);
  const year = next.getFullYear();
  const month = String(next.getMonth() + 1).padStart(2, "0");
  const day = String(next.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function pauseCreditLabel(days: number): string {
  if (days <= 0) return "";
  return `${days} day${days === 1 ? "" : "s"}`;
}
