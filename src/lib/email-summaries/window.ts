/**
 * Timezone-aware scheduling maths for emailed calendar summaries.
 *
 * Everything here is pure so it can be unit-tested: day keys are `yyyy-MM-dd`
 * strings in the household timezone, and instants are real UTC `Date`s. DST is
 * handled by asking Intl for the zone's offset at the candidate instant, so
 * "6:00 PM local" stays 6:00 PM across spring-forward and fall-back.
 */

export type SummaryFrequency = "daily" | "weekly" | "monthly";

export interface SummaryWindow {
  frequency: SummaryFrequency;
  /** first covered day, inclusive */
  startDayKey: string;
  /** last covered day, inclusive */
  endDayKey: string;
  /** stable key used for duplicate-send protection */
  periodKey: string;
}

export interface DueRun {
  window: SummaryWindow;
  /** the local send moment this run belongs to */
  sendAt: Date;
}

const DAY_MS = 86_400_000;
const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

/** How long after a missed send it is still worth emailing (cron outage catch-up). */
export const DEFAULT_STALENESS_MS = 6 * 60 * 60 * 1000;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const out: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return {
    year: out["year"] ?? 1970,
    month: out["month"] ?? 1,
    day: out["day"] ?? 1,
    hour: out["hour"] ?? 0,
    minute: out["minute"] ?? 0,
    second: out["second"] ?? 0,
  };
}

function offsetMs(ts: number, timeZone: string): number {
  const p = zonedParts(new Date(ts), timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ts;
}

export function dayKeyInZone(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function parseDayKey(dayKey: string): { year: number; month: number; day: number } {
  const [y, m, d] = dayKey.split("-").map(Number);
  return { year: y ?? 1970, month: m ?? 1, day: d ?? 1 };
}

export function addDays(dayKey: string, days: number): string {
  const { year, month, day } = parseDayKey(dayKey);
  const next = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
  return next.toISOString().slice(0, 10);
}

export function daysBetween(fromDayKey: string, toDayKey: string): number {
  const a = parseDayKey(fromDayKey);
  const b = parseDayKey(toDayKey);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS,
  );
}

/** 0 = Sunday, matching JS `getDay()`. */
export function weekdayIndex(dayKey: string): number {
  const { year, month, day } = parseDayKey(dayKey);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function weekdayCode(dayKey: string): string {
  return DAY_CODES[weekdayIndex(dayKey)]!;
}

/** Monday of the week containing `dayKey` (weeks are Monday-first). */
export function mondayOf(dayKey: string): string {
  const index = weekdayIndex(dayKey);
  return addDays(dayKey, index === 0 ? -6 : 1 - index);
}

export function lastDayOfMonth(dayKey: string): string {
  const { year, month } = parseDayKey(dayKey);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** Real instant for a wall-clock time in the household timezone. */
export function zonedInstant(dayKey: string, timeZone: string, hour: number, minute: number): Date {
  const { year, month, day } = parseDayKey(dayKey);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let ts = target - offsetMs(target, timeZone);
  ts = target - offsetMs(ts, timeZone);
  return new Date(ts);
}

export function parseSendTime(sendTime: string): { hour: number; minute: number } {
  const [h, m] = String(sendTime).split(":").map(Number);
  return { hour: h ?? 18, minute: m ?? 0 };
}

/** The window a send fired on `sendDayKey` covers. */
export function windowForSendDay(
  frequency: SummaryFrequency,
  sendDayKey: string,
): SummaryWindow {
  if (frequency === "daily") {
    const day = addDays(sendDayKey, 1);
    return { frequency, startDayKey: day, endDayKey: day, periodKey: `daily:${day}` };
  }
  if (frequency === "weekly") {
    const monday = addDays(sendDayKey, 1);
    return {
      frequency,
      startDayKey: monday,
      endDayKey: addDays(monday, 6),
      periodKey: `weekly:${monday}`,
    };
  }
  // monthly: sends 3 days before the covered month starts
  const first = addDays(sendDayKey, 3);
  return {
    frequency,
    startDayKey: first,
    endDayKey: lastDayOfMonth(first),
    periodKey: `monthly:${first.slice(0, 7)}`,
  };
}

/** Candidate local send days for a frequency, newest first. */
function candidateSendDays(frequency: SummaryFrequency, todayKey: string): string[] {
  if (frequency === "daily") return [todayKey, addDays(todayKey, -1)];
  if (frequency === "weekly") {
    const index = weekdayIndex(todayKey);
    const lastSunday = addDays(todayKey, -index); // Sunday = 0
    return [lastSunday, addDays(lastSunday, -7)];
  }
  const { year, month } = parseDayKey(todayKey);
  const thisFirst = `${year}-${pad(month)}-01`;
  const nextFirst = addDays(lastDayOfMonth(todayKey), 1);
  return [addDays(nextFirst, -3), addDays(thisFirst, -3)];
}

/**
 * The most recent scheduled send that is already due, or null when the next
 * send is still in the future (or so overdue that emailing it is pointless).
 */
export function dueRun(
  schedule: { frequency: SummaryFrequency; send_time: string },
  now: Date,
  timeZone: string,
  stalenessMs: number = DEFAULT_STALENESS_MS,
): DueRun | null {
  const { hour, minute } = parseSendTime(schedule.send_time);
  const todayKey = dayKeyInZone(now, timeZone);
  let best: DueRun | null = null;
  for (const sendDay of candidateSendDays(schedule.frequency, todayKey)) {
    const sendAt = zonedInstant(sendDay, timeZone, hour, minute);
    if (sendAt.getTime() > now.getTime()) continue;
    if (!best || sendAt.getTime() > best.sendAt.getTime()) {
      best = { sendAt, window: windowForSendDay(schedule.frequency, sendDay) };
    }
  }
  if (!best) return null;
  if (now.getTime() - best.sendAt.getTime() > stalenessMs) return null;
  return best;
}

/**
 * The scheduled send that is about to happen within `leadMs`, or null.
 *
 * Used by the pre-send calendar refresh: at 5:55 PM this returns the 6:00 PM
 * run (with the exact window that run will cover), so the refresh and the send
 * agree on the period key and cannot disagree about which email is coming.
 */
export function upcomingRun(
  schedule: { frequency: SummaryFrequency; send_time: string },
  now: Date,
  timeZone: string,
  leadMs: number,
): DueRun | null {
  return dueRun(schedule, new Date(now.getTime() + leadMs), timeZone, leadMs);
}

/** Window used by "Send preview" — the next period the schedule would cover. */
export function previewWindow(
  frequency: SummaryFrequency,
  now: Date,
  timeZone: string,
): SummaryWindow {
  const todayKey = dayKeyInZone(now, timeZone);
  if (frequency === "daily") return windowForSendDay("daily", todayKey);
  if (frequency === "weekly") {
    const monday = mondayOf(todayKey);
    return {
      frequency,
      startDayKey: monday,
      endDayKey: addDays(monday, 6),
      periodKey: `weekly:${monday}`,
    };
  }
  const first = `${todayKey.slice(0, 7)}-01`;
  return {
    frequency,
    startDayKey: first,
    endDayKey: lastDayOfMonth(first),
    periodKey: `monthly:${first.slice(0, 7)}`,
  };
}
