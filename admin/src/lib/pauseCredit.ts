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

export function addCalendarMonths(date: string, months: number): string | null {
  if (!date || !Number.isFinite(months)) return date || null;
  const parsed = Date.parse(`${date}T00:00:00`);
  if (Number.isNaN(parsed)) return null;
  const start = new Date(parsed);
  const day = start.getDate();
  const next = new Date(start);
  next.setMonth(next.getMonth() + months);
  if (next.getDate() !== day) {
    next.setDate(0);
  }
  const year = next.getFullYear();
  const month = String(next.getMonth() + 1).padStart(2, "0");
  const nextDay = String(next.getDate()).padStart(2, "0");
  return `${year}-${month}-${nextDay}`;
}

export function pauseMaxDuration(
  paymentFrequency?: string | null,
  customPeriodDays?: number | string | null
): { unit: "weeks" | "months"; amount: number; label: string } {
  const freq = String(paymentFrequency || "monthly").trim().toLowerCase();
  if (freq === "yearly") {
    return { unit: "months", amount: 1, label: "1 month" };
  }
  if (freq === "quarterly") {
    return { unit: "weeks", amount: 2, label: "2 weeks" };
  }
  if (freq === "custom") {
    const days = Number(customPeriodDays);
    if (Number.isFinite(days) && days >= 360) {
      return { unit: "months", amount: 1, label: "1 month" };
    }
    if (Number.isFinite(days) && days >= 80) {
      return { unit: "weeks", amount: 2, label: "2 weeks" };
    }
  }
  return { unit: "weeks", amount: 1, label: "1 week" };
}

export function maxPauseEndDate(
  pauseStart?: string | null,
  paymentFrequency?: string | null,
  customPeriodDays?: number | string | null
): string | null {
  if (!pauseStart) return null;
  const max = pauseMaxDuration(paymentFrequency, customPeriodDays);
  if (max.unit === "months") {
    return addCalendarMonths(pauseStart, max.amount);
  }
  return addCalendarDays(pauseStart, max.amount * 7);
}

export function pauseDurationHint(
  paymentFrequency?: string | null,
  customPeriodDays?: number | string | null
): string {
  const max = pauseMaxDuration(paymentFrequency, customPeriodDays);
  const freq = String(paymentFrequency || "monthly").trim().toLowerCase();
  const plan =
    freq === "yearly"
      ? "Yearly"
      : freq === "quarterly"
        ? "Quarterly"
        : freq === "custom"
          ? "Custom-period"
          : "Monthly";
  return `${plan} customers can pause for ${max.label} per paid period, split across shorter stays. Unused days are credited in Zoho and the recurring invoice is updated.`;
}

export function pauseCreditLabel(days: number): string {
  if (days <= 0) return "";
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function pauseAllowanceDays(
  paymentFrequency?: string | null,
  customPeriodDays?: number | string | null,
  fromDate?: string | null
): number {
  const start = fromDate || new Date().toISOString().slice(0, 10);
  const maxEnd = maxPauseEndDate(start, paymentFrequency, customPeriodDays);
  if (!maxEnd) return 0;
  return pauseAwayDays(start, maxEnd);
}

export function remainingPauseEndDate(
  pauseStart?: string | null,
  remainingDays?: number | null
): string | null {
  if (!pauseStart || remainingDays == null || remainingDays <= 0) return null;
  return addCalendarDays(pauseStart, remainingDays);
}

export function effectiveMaxPauseEndDate(
  pauseStart?: string | null,
  paymentFrequency?: string | null,
  customPeriodDays?: number | string | null,
  remainingDays?: number | null
): string | null {
  const freqCap = maxPauseEndDate(pauseStart, paymentFrequency, customPeriodDays);
  if (remainingDays == null) return freqCap;
  if (remainingDays <= 0) return pauseStart || null;
  const remainCap = remainingPauseEndDate(pauseStart, remainingDays);
  if (!remainCap) return freqCap;
  if (!freqCap) return remainCap;
  return remainCap < freqCap ? remainCap : freqCap;
}

export type PauseBalance = {
  allowance: number;
  used: number;
  remaining: number;
  exhausted: boolean;
};

export function resolvePauseBalance(customer?: {
  paymentFrequency?: string | null;
  customPeriodDays?: number | string | null;
  lastPaymentDate?: string | null;
  pauseCreditDays?: number | null;
  pauseCreditAppliedAt?: string | null;
  pauseAllowanceDays?: number | null;
  pauseDaysUsed?: number | null;
  pauseDaysRemaining?: number | null;
} | null): PauseBalance {
  if (
    customer?.pauseAllowanceDays != null &&
    customer.pauseDaysUsed != null &&
    customer.pauseDaysRemaining != null
  ) {
    const allowance = Math.max(0, Number(customer.pauseAllowanceDays) || 0);
    const used = Math.max(0, Number(customer.pauseDaysUsed) || 0);
    const remaining = Math.max(0, Number(customer.pauseDaysRemaining) || 0);
    return {
      allowance,
      used,
      remaining,
      exhausted: allowance > 0 && remaining <= 0,
    };
  }
  const allowance = pauseAllowanceDays(
    customer?.paymentFrequency,
    customer?.customPeriodDays,
    customer?.lastPaymentDate
  );
  const used = customer?.pauseCreditAppliedAt
    ? 0
    : Math.max(0, Number(customer?.pauseCreditDays) || 0);
  const remaining = Math.max(0, allowance - used);
  return {
    allowance,
    used,
    remaining,
    exhausted: allowance > 0 && remaining <= 0,
  };
}

export function exhaustedPauseDaysMessage(balance: PauseBalance): string {
  if (balance.allowance > 0) {
    return `This customer has exhausted pause days (${balance.used} of ${balance.allowance} used this billing period)`;
  }
  return "This customer has exhausted pause days";
}

export function pauseBalanceLabel(balance: PauseBalance): string {
  if (balance.exhausted) {
    return `Pause days exhausted (${balance.used} of ${balance.allowance} used)`;
  }
  if (balance.used > 0) {
    return `${balance.remaining} of ${balance.allowance} pause days remaining`;
  }
  return `${balance.allowance} pause days available this billing period`;
}
