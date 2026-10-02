/** Pay-period math on household-local date keys ("YYYY-MM-DD"). Pure, shared. */

export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";

export interface PaySettings {
  frequency: PayFrequency;
  anchor_date: string;
  /** Twice monthly: first period is day 1..this; second is the rest of the month. */
  semimonthly_first_end: number;
}

export const DEFAULT_PAY_SETTINGS: PaySettings = {
  frequency: "biweekly",
  anchor_date: "2026-01-04",
  semimonthly_first_end: 15,
};

export const FREQUENCY_LABEL: Record<PayFrequency, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  semimonthly: "Twice monthly",
  monthly: "Monthly",
};

const toUtc = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};
const toKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;
export const addDaysKey = (key: string, n: number) => toKey(toUtc(key) + n * DAY);
const lastDay = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

export interface PayPeriod {
  start: string;
  end: string;
}

/** Period containing `todayKey`, shifted by `offset` periods (negative = earlier). */
export function payPeriodFor(s: PaySettings, todayKey: string, offset = 0): PayPeriod {
  if (s.frequency === "weekly" || s.frequency === "biweekly") {
    const len = s.frequency === "weekly" ? 7 : 14;
    const diff = Math.floor((toUtc(todayKey) - toUtc(s.anchor_date)) / DAY);
    const idx = Math.floor(diff / len) + offset;
    const start = addDaysKey(s.anchor_date, idx * len);
    return { start, end: addDaysKey(start, len - 1) };
  }
  const [ty, tm, td] = todayKey.split("-").map(Number) as [number, number, number];
  if (s.frequency === "monthly") {
    const d = new Date(Date.UTC(ty, tm - 1 + offset, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    return { start: toKey(d.getTime()), end: toKey(Date.UTC(y, m, lastDay(y, m))) };
  }
  const cut = Math.min(Math.max(s.semimonthly_first_end, 1), 27);
  let half = (ty * 12 + (tm - 1)) * 2 + (td > cut ? 1 : 0) + offset;
  const monthIdx = Math.floor(half / 2);
  half = half - monthIdx * 2;
  const y = Math.floor(monthIdx / 12);
  const m = monthIdx - y * 12;
  return half === 0
    ? { start: toKey(Date.UTC(y, m, 1)), end: toKey(Date.UTC(y, m, cut)) }
    : { start: toKey(Date.UTC(y, m, cut + 1)), end: toKey(Date.UTC(y, m, lastDay(y, m))) };
}

export function eachDateKey(p: PayPeriod): string[] {
  const out: string[] = [];
  for (let k = p.start; k <= p.end; k = addDaysKey(k, 1)) out.push(k);
  return out;
}

export function hoursBetween(startIso: string | null, endIso: string | null): number {
  if (!startIso || !endIso) return 0;
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return ms > 0 ? ms / 3_600_000 : 0;
}

/** Display-only hours for local "HH:mm" inputs; end <= start counts as overnight (matches server). */
export function localHours(start: string, end: string): number {
  const m = (v: string) => { const [h, mi] = v.split(":").map(Number); return (h ?? 0) * 60 + (mi ?? 0); };
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return 0;
  let d = m(end) - m(start);
  if (d <= 0) d += 1440;
  return d / 60;
}

export const formatHours = (h: number) => `${Number((Math.round(h * 100) / 100).toFixed(2))} h`;

export type TimesheetStatus = "draft" | "submitted" | "needs_correction" | "approved";
export const STATUS_LABEL: Record<TimesheetStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  needs_correction: "Needs correction",
  approved: "Approved",
};
