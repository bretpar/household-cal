/**
 * The Activities tab ("Event Library") is derived from the real `events` /
 * `event_members` data — there is no separate activity record and no
 * synchronisation. Everything here is pure so it can be unit tested.
 *
 * A "series" is simply an event that carries a recurrence rule. One-time events
 * are excluded from the default view.
 */

import { addDays, startOfDay } from "date-fns";

import {
  EVENT_TYPES,
  WEEKDAY_CODES,
  expandOccurrences,
  parseRecurrenceRule,
  type CalendarEvent,
  type EventType,
  type FamilyMember,
  type MemberId,
  type WeekdayCode,
} from "@/lib/family-data";
import {
  resolveEventCategory,
  UNCATEGORIZED_LABEL,
  type EventCategory,
} from "@/lib/event-categories";

export type GroupMode = "category" | "day" | "frequency" | "duration" | "member" | "none";
export type SortMode = "name" | "next" | "start" | "created";

export const GROUP_MODES: { id: GroupMode; label: string }[] = [
  { id: "category", label: "Category" },
  { id: "day", label: "Day of week" },
  { id: "frequency", label: "Frequency" },
  { id: "duration", label: "Duration" },
  { id: "member", label: "Family member" },
  { id: "none", label: "None" },
];

export const SORT_MODES: { id: SortMode; label: string }[] = [
  { id: "name", label: "Name" },
  { id: "next", label: "Next occurrence" },
  { id: "start", label: "Start date" },
  { id: "created", label: "Recently added" },
];

/** Plural section headings for the category grouping. */
const CATEGORY_SECTIONS: Record<EventType, string> = {
  school: "School",
  activity: "Activities",
  work: "Work",
  childcare: "Childcare",
  appointment: "Appointments",
  family: "Family",
  travel: "Travel",
  birthday: "Birthdays",
  other: "Other",
};

const CATEGORY_ORDER = EVENT_TYPES.map((t) => t.id);
const WEEKDAY_ORDER = WEEKDAY_CODES.map((d) => d.code);
const CODE_BY_JS_DAY: WeekdayCode[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export interface EventSeries {
  event: CalendarEvent;
  /** first upcoming occurrence at or after `from`, or null when the series has ended */
  nextOccurrence: Date | null;
  ended: boolean;
  /** minutes between start_at and end_at */
  durationMinutes: number;
  /** weekdays the series can land on */
  weekdays: WeekdayCode[];
  /** members with a weekday rule of their own */
  perPersonDays: { member_id: MemberId; weekdays: WeekdayCode[] }[];
}

export function isSeries(event: CalendarEvent): boolean {
  return Boolean(event.recurrence_rule);
}

/** Weekdays the series can produce an occurrence on. */
export function weekdaysForSeries(event: CalendarEvent): WeekdayCode[] {
  const rule = parseRecurrenceRule(event.recurrence_rule);
  const collected = new Set<WeekdayCode>();
  if (rule?.byDay) for (const code of rule.byDay) collected.add(code as WeekdayCode);
  for (const p of event.participants) {
    for (const code of p.weekdays ?? []) collected.add(code);
  }
  if (collected.size === 0 && rule?.freq === "WEEKLY") {
    collected.add(CODE_BY_JS_DAY[new Date(event.start_at).getDay()]!);
  }
  return WEEKDAY_ORDER.filter((code) => collected.has(code));
}

/** First occurrence at or after `from`, looking ahead at most ~14 months. */
export function nextOccurrenceOf(event: CalendarEvent, from: Date): Date | null {
  const start = startOfDay(from);
  const found = expandOccurrences([event], start, addDays(start, 430));
  return found[0]?.start ?? null;
}

export function toSeries(event: CalendarEvent, now: Date): EventSeries {
  const next = nextOccurrenceOf(event, now);
  return {
    event,
    nextOccurrence: next,
    ended: next === null,
    durationMinutes: Math.max(
      0,
      Math.round(
        (new Date(event.end_at).getTime() - new Date(event.start_at).getTime()) / 60_000,
      ),
    ),
    weekdays: weekdaysForSeries(event),
    perPersonDays: event.participants
      .filter((p) => p.weekdays && p.weekdays.length > 0)
      .map((p) => ({ member_id: p.member_id, weekdays: p.weekdays! })),
  };
}

/** The default Activities dataset: recurring series only, active and ended. */
export function buildSeriesList(events: CalendarEvent[], now = new Date()): EventSeries[] {
  return events.filter(isSeries).map((event) => toSeries(event, now));
}

export function frequencyLabel(event: CalendarEvent): string {
  const rule = parseRecurrenceRule(event.recurrence_rule);
  if (!rule) return "Custom schedule";
  if (rule.freq === "DAILY") return rule.interval === 1 ? "Daily" : `Every ${rule.interval} days`;
  if (rule.freq === "MONTHLY") {
    return rule.interval === 1 ? "Monthly" : `Every ${rule.interval} months`;
  }
  if (rule.interval > 1) return `Every ${rule.interval} weeks`;
  return "Weekly";
}

export function durationLabel(minutes: number): string {
  if (minutes <= 0) return "No set length";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  const rounded = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  return `${rounded} hr`;
}

function durationBucket(minutes: number): { key: string; label: string; order: number } {
  if (minutes <= 30) return { key: "0-30", label: "30 minutes or less", order: 0 };
  if (minutes <= 60) return { key: "30-60", label: "About an hour", order: 1 };
  if (minutes <= 180) return { key: "1-3", label: "1–3 hours", order: 2 };
  if (minutes < 24 * 60) return { key: "3-24", label: "Most of the day", order: 3 };
  return { key: "all-day", label: "All day or longer", order: 4 };
}

export function categorySection(type: EventType): string {
  return CATEGORY_SECTIONS[type] ?? "Other";
}

export interface SeriesGroup {
  key: string;
  label: string;
  items: EventSeries[];
}

const compareName = (a: EventSeries, b: EventSeries) =>
  a.event.title.localeCompare(b.event.title, "en", { sensitivity: "base" });

export function sortSeries(items: EventSeries[], mode: SortMode): EventSeries[] {
  const sorted = [...items];
  if (mode === "name") return sorted.sort(compareName);
  if (mode === "start") {
    return sorted.sort(
      (a, b) =>
        new Date(a.event.start_at).getTime() - new Date(b.event.start_at).getTime() ||
        compareName(a, b),
    );
  }
  if (mode === "created") {
    return sorted.sort(
      (a, b) =>
        new Date(b.event.created_at ?? b.event.start_at).getTime() -
          new Date(a.event.created_at ?? a.event.start_at).getTime() || compareName(a, b),
    );
  }
  // next occurrence — ended series sink to the bottom
  return sorted.sort((a, b) => {
    if (a.nextOccurrence && b.nextOccurrence) {
      return a.nextOccurrence.getTime() - b.nextOccurrence.getTime() || compareName(a, b);
    }
    if (a.nextOccurrence) return -1;
    if (b.nextOccurrence) return 1;
    return compareName(a, b);
  });
}

/**
 * Groups series for display. A series can appear in more than one section when
 * the grouping is multi-valued (days of week, family members).
 */
export function groupSeries(
  items: EventSeries[],
  mode: GroupMode,
  sort: SortMode,
  members: FamilyMember[] = [],
  categories: EventCategory[] = [],
): SeriesGroup[] {
  const buckets = new Map<string, { label: string; order: number; items: EventSeries[] }>();
  const push = (key: string, label: string, order: number, item: EventSeries) => {
    const bucket = buckets.get(key) ?? { label, order, items: [] };
    bucket.items.push(item);
    buckets.set(key, bucket);
  };

  for (const series of items) {
    if (mode === "none") {
      push("all", "All repeating events", 0, series);
    } else if (mode === "category") {
      // Household Event Categories are the source of truth; fall back to the
      // Uncategorized bucket when an event has no category row.
      const category = resolveEventCategory(categories, series.event);
      if (category) {
        const order = categories.findIndex((c) => c.id === category.id);
        push(category.id, category.name, order < 0 ? 90 : order, series);
      } else {
        push("uncategorized", UNCATEGORIZED_LABEL, 99, series);
      }
    } else if (mode === "frequency") {
      const label = frequencyLabel(series.event);
      push(label, label, 0, series);
    } else if (mode === "duration") {
      const bucket = durationBucket(series.durationMinutes);
      push(bucket.key, bucket.label, bucket.order, series);
    } else if (mode === "day") {
      if (series.weekdays.length === 0) {
        push("unscheduled", "No fixed weekday", 99, series);
      } else {
        for (const code of series.weekdays) {
          const day = WEEKDAY_CODES.find((d) => d.code === code);
          push(code, day?.label ?? code, WEEKDAY_ORDER.indexOf(code), series);
        }
      }
    } else {
      const ids = Array.from(new Set(series.event.member_ids));
      if (ids.length === 0) {
        push("unassigned", "Needs family assignment", 99, series);
      } else {
        for (const id of ids) {
          const member = members.find((m) => m.id === id);
          push(
            id,
            member?.name ?? "Family member",
            member ? member.sort_order : 50,
            series,
          );
        }
      }
    }
  }

  return Array.from(buckets.entries())
    .map(([key, bucket]) => ({
      key,
      label: bucket.label,
      items: sortSeries(bucket.items, sort),
      order: bucket.order,
    }))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map(({ key, label, items }) => ({ key, label, items }));
}
