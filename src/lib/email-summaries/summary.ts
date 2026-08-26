/**
 * Turns household events into the day-grouped content of a summary email.
 *
 * Pure and timezone-aware: recurrence is expanded over `yyyy-MM-dd` day keys in
 * the household timezone, and every event's clock time comes from its own
 * wall-clock time in that zone, so DST shifts never move an event's label.
 */

import { parseRecurrenceRule } from "@/lib/family-data";

import {
  addDays,
  daysBetween,
  dayKeyInZone,
  mondayOf,
  parseDayKey,
  weekdayCode,
  weekdayIndex,
  type SummaryFrequency,
  type SummaryWindow,
} from "./window";

export interface SummaryMember {
  id: string;
  initial: string;
  color: string;
}

export interface SummaryEvent {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  calendar_source_id: string | null;
  display_mode?: string | null;
  recurrence_rule: string | null;
  recurrence_until: string | null;
  excluded_dates?: string[] | null;
  participants?: { member_id: string; weekdays: string[] | null }[];
  member_ids?: string[];
}

export interface SummaryBadge {
  initial: string;
  color: string;
}

export interface SummaryItem {
  title: string;
  time: string;
  allDay: boolean;
  badges: SummaryBadge[];
  sortKey: number;
}

export interface SummaryDay {
  dayKey: string;
  label: string;
  items: SummaryItem[];
}

/** Which calendars a recipient's email is built from. Empty = every calendar. */
export interface CalendarSelection {
  sourceIds: string[];
  /** the household's main calendar — owns events stored without a source */
  mainSourceId?: string | null;
}

function participantsOn(event: SummaryEvent, dayKey: string): string[] {
  const code = weekdayCode(dayKey);
  const source =
    event.participants && event.participants.length > 0
      ? event.participants
      : (event.member_ids ?? []).map((member_id) => ({ member_id, weekdays: null }));
  return source
    .filter((p) => !p.weekdays || p.weekdays.length === 0 || p.weekdays.includes(code))
    .map((p) => p.member_id);
}

function hasParticipantsOn(event: SummaryEvent, dayKey: string): boolean {
  const hasRules = (event.participants ?? []).some((p) => p.weekdays && p.weekdays.length > 0);
  if (!hasRules) return true;
  return participantsOn(event, dayKey).length > 0;
}

export function occursOnDayKey(event: SummaryEvent, dayKey: string, timeZone: string): boolean {
  const startKey = dayKeyInZone(new Date(event.start_at), timeZone);
  if (event.excluded_dates?.includes(dayKey)) return false;
  if (event.recurrence_until && dayKey > event.recurrence_until) return false;

  const rule = parseRecurrenceRule(event.recurrence_rule);
  if (!rule) return dayKey === startKey;

  const dayDiff = daysBetween(startKey, dayKey);
  if (dayDiff < 0) return false;

  let index: number | null = null;
  if (rule.freq === "DAILY") {
    index = dayDiff % rule.interval === 0 ? dayDiff / rule.interval : null;
  } else if (rule.freq === "MONTHLY") {
    const start = parseDayKey(startKey);
    const day = parseDayKey(dayKey);
    if (start.day !== day.day) return false;
    const months = (day.year - start.year) * 12 + (day.month - start.month);
    index = months % rule.interval === 0 ? months / rule.interval : null;
  } else {
    const codes = rule.byDay ?? [weekdayCode(startKey)];
    if (!codes.includes(weekdayCode(dayKey))) return false;
    const weeks = Math.abs(daysBetween(mondayOf(startKey), mondayOf(dayKey)) / 7);
    if (weeks % rule.interval !== 0) return false;
    const order = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
    const inWeek = [...codes]
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .indexOf(weekdayCode(dayKey));
    index = (weeks / rule.interval) * codes.length + inWeek;
  }

  if (index === null) return false;
  if (rule.count !== null && index >= rule.count) return false;
  return true;
}

/** Keeps only the events a recipient is allowed to see, coverage layers aside. */
export function eventsForSelection(
  events: SummaryEvent[],
  selection: CalendarSelection,
): SummaryEvent[] {
  const allowed = new Set(selection.sourceIds);
  return events.filter((event) => {
    if (event.display_mode === "coverage_background") return false;
    if (allowed.size === 0) return true;
    if (event.calendar_source_id) return allowed.has(event.calendar_source_id);
    // events stored without a calendar belong to the household's main calendar
    return selection.mainSourceId ? allowed.has(selection.mainSourceId) : false;
  });
}

function clockLabel(hour: number, minute: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h >= 12 ? "PM" : "AM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function wallClock(date: Date, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const out: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") out[p.type] = Number(p.value);
  return { hour: out["hour"] ?? 0, minute: out["minute"] ?? 0 };
}

export function formatDayLabel(dayKey: string): string {
  const { year, month, day } = parseDayKey(dayKey);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function formatLongDate(dayKey: string): string {
  const { year, month, day } = parseDayKey(dayKey);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
  });
}

export function formatShortDate(dayKey: string): string {
  const { year, month, day } = parseDayKey(dayKey);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

export function formatMonthName(dayKey: string): string {
  const { year, month } = parseDayKey(dayKey);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
  });
}

/** Weekday codes a recipient receives. Empty/undefined = every day. */
export type WeekdaySelection = string[] | null | undefined;

export function includesWeekday(selection: WeekdaySelection, dayKey: string): boolean {
  if (!selection || selection.length === 0) return true;
  return selection.includes(weekdayCode(dayKey));
}

/** Days inside the window that a recipient's day filter keeps. */
export function selectedDaysInWindow(window: SummaryWindow, selection: WeekdaySelection): string[] {
  const days: string[] = [];
  for (let dayKey = window.startDayKey; dayKey <= window.endDayKey; dayKey = addDays(dayKey, 1)) {
    if (includesWeekday(selection, dayKey)) days.push(dayKey);
  }
  return days;
}

export function buildSummaryDays(
  events: SummaryEvent[],
  window: SummaryWindow,
  timeZone: string,
  members: SummaryMember[],
  weekdays?: WeekdaySelection,
): SummaryDay[] {
  const memberById = new Map(members.map((m) => [m.id, m]));
  const days: SummaryDay[] = [];

  for (let dayKey = window.startDayKey; dayKey <= window.endDayKey; dayKey = addDays(dayKey, 1)) {
    // recipient day filter is applied after calendar filtering
    if (!includesWeekday(weekdays, dayKey)) continue;
    const items: SummaryItem[] = [];
    for (const event of events) {
      if (!occursOnDayKey(event, dayKey, timeZone)) continue;
      if (!hasParticipantsOn(event, dayKey)) continue;

      const badges = participantsOn(event, dayKey)
        .map((id) => memberById.get(id))
        .filter((m): m is SummaryMember => Boolean(m))
        .map((m) => ({ initial: m.initial, color: m.color }));

      if (event.all_day) {
        items.push({ title: event.title, time: "All day", allDay: true, badges, sortKey: 9999 });
        continue;
      }
      const start = wallClock(new Date(event.start_at), timeZone);
      const durationMinutes = Math.max(
        0,
        Math.round(
          (new Date(event.end_at).getTime() - new Date(event.start_at).getTime()) / 60_000,
        ),
      );
      const endTotal = start.hour * 60 + start.minute + durationMinutes;
      items.push({
        title: event.title,
        time: `${clockLabel(start.hour, start.minute)} – ${clockLabel(Math.floor(endTotal / 60), endTotal % 60)}`,
        allDay: false,
        badges,
        sortKey: start.hour * 60 + start.minute,
      });
    }
    if (items.length === 0) continue;
    items.sort((a, b) => a.sortKey - b.sortKey || a.title.localeCompare(b.title));
    days.push({ dayKey, label: formatDayLabel(dayKey), items });
  }
  return days;
}

export interface SummaryCopy {
  subject: string;
  heading: string;
  intro: string;
  emptyMessage: string;
}

export function summaryCopy(
  frequency: SummaryFrequency,
  window: SummaryWindow,
  brand = "Our Family Calendar",
): SummaryCopy {
  if (frequency === "daily") {
    return {
      subject: `${brand} · Tomorrow`,
      heading: `Tomorrow, ${formatLongDate(window.startDayKey)}`,
      intro: "Here are the activities for tomorrow.",
      emptyMessage: "No activities are scheduled for tomorrow.",
    };
  }
  if (frequency === "weekly") {
    return {
      subject: `${brand} · Week of ${formatShortDate(window.startDayKey)}`,
      heading: `Welcome to the week of ${formatLongDate(window.startDayKey)}.`,
      intro: "Here are the activities for the week.",
      emptyMessage: "No activities are scheduled for this week.",
    };
  }
  const month = formatMonthName(window.startDayKey);
  return {
    subject: `${brand} · ${month}`,
    heading: `Welcome to ${month}.`,
    intro: "Here are the activities for the month.",
    emptyMessage: `No activities are scheduled for ${month}.`,
  };
}

// re-exported for convenience in server code
export { weekdayIndex };
