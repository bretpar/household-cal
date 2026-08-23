/**
 * Data model for Parker Family Calendar.
 *
 * The shapes below mirror the eventual database tables so that Google Calendar
 * sync can be layered on later without redesigning the app:
 *   family_members / events / event_members / calendar_sources
 */

import {
  addDays,
  differenceInCalendarDays,
  differenceInCalendarWeeks,
  isSameDay,
  startOfDay,
  startOfWeek,
} from "date-fns";

export type MemberId = "d" | "m" | "b" | "e" | "j";
export type Role = "parent" | "child" | "caregiver";
export type AccessLevel = "full" | "view_only";

export interface FamilyMember {
  id: MemberId;
  name: string;
  initial: string;
  /** design-system token key, resolved to classes in memberStyles */
  color: MemberId;
  role: Role;
  access: AccessLevel;
  active: boolean;
}

export type EventType =
  | "school"
  | "activity"
  | "work"
  | "childcare"
  | "appointment"
  | "family"
  | "other";

export type SourceCalendarId = "parker_family" | "babysitter";
export type DisplayMode = "events" | "coverage_background";

export interface CalendarSource {
  id: SourceCalendarId;
  name: string;
  source_type: "local" | "google";
  external_calendar_id: string | null;
  display_mode: DisplayMode;
}

export interface CalendarEvent {
  id: string;
  title: string;
  /** ISO datetime of the first occurrence */
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  notes: string | null;
  event_type: EventType;
  /** simplified RRULE placeholder, null = single event */
  recurrence_rule: string | null;
  /** ISO date (yyyy-MM-dd) of the last day the series may occur — mirrors RRULE UNTIL */
  recurrence_until?: string | null;
  /** ISO dates (yyyy-MM-dd) removed from the series — mirrors Google EXDATE */
  excluded_dates?: string[];
  source_calendar: SourceCalendarId;
  google_calendar_id: string | null;
  google_event_id: string | null;
  /** event_members join table, flattened for the mock layer */
  member_ids: MemberId[];
}

export interface FamilyActivity {
  id: string;
  name: string;
  member_ids: MemberId[];
  schedule_label: string;
  location: string;
  recurrence_rule: string;
  active: boolean;
}

export const FAMILY_MEMBERS: FamilyMember[] = [
  { id: "d", name: "Dad", initial: "D", color: "d", role: "parent", access: "full", active: true },
  { id: "m", name: "Mom", initial: "M", color: "m", role: "parent", access: "full", active: true },
  {
    id: "b",
    name: "Bailey",
    initial: "B",
    color: "b",
    role: "child",
    access: "view_only",
    active: true,
  },
  {
    id: "e",
    name: "Ellison",
    initial: "E",
    color: "e",
    role: "child",
    access: "view_only",
    active: true,
  },
  {
    id: "j",
    name: "Jack",
    initial: "J",
    color: "j",
    role: "child",
    access: "view_only",
    active: true,
  },
];

export const CAREGIVERS = [
  { id: "babysitter", name: "Babysitter", role: "caregiver" as Role, access: "view_only" as const },
];

export const CALENDAR_SOURCES: CalendarSource[] = [
  {
    id: "parker_family",
    name: "Parker Family",
    source_type: "local",
    external_calendar_id: null,
    display_mode: "events",
  },
  {
    id: "babysitter",
    name: "Babysitter",
    source_type: "local",
    external_calendar_id: null,
    display_mode: "coverage_background",
  },
];

export const EVENT_TYPES: { id: EventType; label: string }[] = [
  { id: "school", label: "School" },
  { id: "activity", label: "Activity" },
  { id: "work", label: "Work" },
  { id: "childcare", label: "Childcare" },
  { id: "appointment", label: "Appointment" },
  { id: "family", label: "Family" },
  { id: "other", label: "Other" },
];

export const RECURRENCE_OPTIONS = [
  { id: "none", label: "Does not repeat", rule: null },
  { id: "daily", label: "Daily", rule: "FREQ=DAILY" },
  { id: "weekly", label: "Weekly", rule: "FREQ=WEEKLY" },
  { id: "biweekly", label: "Every 2 weeks", rule: "FREQ=WEEKLY;INTERVAL=2" },
  { id: "monthly", label: "Monthly", rule: "FREQ=MONTHLY" },
  { id: "custom", label: "Custom (coming soon)", rule: "CUSTOM" },
] as const;

export const memberStyles: Record<
  MemberId,
  { badge: string; soft: string; ring: string; dot: string }
> = {
  d: {
    badge: "bg-member-d text-member-foreground",
    soft: "bg-member-d-soft",
    ring: "ring-member-d",
    dot: "bg-member-d",
  },
  m: {
    badge: "bg-member-m text-member-foreground",
    soft: "bg-member-m-soft",
    ring: "ring-member-m",
    dot: "bg-member-m",
  },
  b: {
    badge: "bg-member-b text-member-foreground",
    soft: "bg-member-b-soft",
    ring: "ring-member-b",
    dot: "bg-member-b",
  },
  e: {
    badge: "bg-member-e text-member-foreground",
    soft: "bg-member-e-soft",
    ring: "ring-member-e",
    dot: "bg-member-e",
  },
  j: {
    badge: "bg-member-j text-member-foreground",
    soft: "bg-member-j-soft",
    ring: "ring-member-j",
    dot: "bg-member-j",
  },
};

export function getMember(id: MemberId): FamilyMember {
  return FAMILY_MEMBERS.find((m) => m.id === id) ?? FAMILY_MEMBERS[0]!;
}

/* ---------------------------------------------------------------- mock data */

function iso(base: Date, dayOffset: number, hour: number, minute = 0): string {
  const d = addDays(startOfDay(base), dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** Monday of the current week — mock data is anchored here so it always looks current. */
export function anchorMonday(today = new Date()): Date {
  return startOfWeek(today, { weekStartsOn: 1 });
}

export function buildSampleEvents(today = new Date()): CalendarEvent[] {
  const mon = anchorMonday(today);
  const base = (
    e: Omit<CalendarEvent, "google_calendar_id" | "google_event_id" | "source_calendar"> &
      Partial<Pick<CalendarEvent, "source_calendar">>,
  ): CalendarEvent => ({
    google_calendar_id: null,
    google_event_id: null,
    source_calendar: "parker_family",
    ...e,
  });

  /** Recurring series start 6 weeks back so earlier weeks/months look populated. */
  const backdate = (e: CalendarEvent): CalendarEvent =>
    e.recurrence_rule && e.recurrence_rule !== "CUSTOM"
      ? {
          ...e,
          start_at: addDays(new Date(e.start_at), -42).toISOString(),
          end_at: addDays(new Date(e.end_at), -42).toISOString(),
        }
      : e;

  return [
    base({
      id: "ev-school",
      title: "School",
      start_at: iso(mon, 0, 8),
      end_at: iso(mon, 0, 15),
      all_day: false,
      location: "Maplewood Elementary",
      notes: "Regular school day",
      event_type: "school",
      recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      member_ids: ["b", "e", "j"],
    }),
    base({
      id: "ev-soccer",
      title: "Soccer Practice",
      start_at: iso(mon, 1, 16, 30),
      end_at: iso(mon, 1, 17, 30),
      all_day: false,
      location: "Riverside Fields",
      notes: "Bring water bottle + shin guards",
      event_type: "activity",
      recurrence_rule: "FREQ=WEEKLY;BYDAY=TU",
      member_ids: ["j"],
    }),
    base({
      id: "ev-dance",
      title: "Dance",
      start_at: iso(mon, 2, 16),
      end_at: iso(mon, 2, 17),
      all_day: false,
      location: "Studio 12",
      notes: "Recital prep",
      event_type: "activity",
      recurrence_rule: "FREQ=WEEKLY;BYDAY=WE",
      member_ids: ["e"],
    }),
    base({
      id: "ev-appt",
      title: "Dentist Appointment",
      start_at: iso(mon, 3, 15, 30),
      end_at: iso(mon, 3, 16, 30),
      all_day: false,
      location: "Bright Smiles Pediatric Dentistry",
      notes: "6-month cleaning",
      event_type: "appointment",
      recurrence_rule: null,
      member_ids: ["b"],
    }),
    base({
      id: "ev-dinner",
      title: "Family Dinner",
      start_at: iso(mon, 6, 17, 30),
      end_at: iso(mon, 6, 19),
      all_day: false,
      location: "Home",
      notes: "Sunday pasta night",
      event_type: "family",
      recurrence_rule: "FREQ=WEEKLY;BYDAY=SU",
      member_ids: ["d", "m", "b", "e", "j"],
    }),
    base({
      id: "ev-dad-work",
      title: "Dad Work",
      start_at: iso(mon, 0, 9),
      end_at: iso(mon, 0, 17),
      all_day: false,
      location: "Downtown office",
      notes: null,
      event_type: "work",
      recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      member_ids: ["d"],
    }),
    base({
      id: "ev-mom-work",
      title: "Mom Work",
      start_at: iso(mon, 0, 8, 30),
      end_at: iso(mon, 0, 16),
      all_day: false,
      location: "Clinic",
      notes: null,
      event_type: "work",
      recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,WE,TH,FR",
      member_ids: ["m"],
    }),
    base({
      id: "ev-teacher-day",
      title: "Teacher In-Service — No School",
      start_at: iso(mon, 4, 0),
      end_at: iso(mon, 4, 23, 59),
      all_day: true,
      location: null,
      notes: "Plan childcare",
      event_type: "school",
      recurrence_rule: null,
      member_ids: ["b", "e", "j"],
    }),
    /* Babysitter coverage lives on its own calendar source and renders as a
       background time-range layer, never as a normal event card. */
    base({
      id: "cov-1",
      title: "Babysitter",
      start_at: iso(mon, 1, 8),
      end_at: iso(mon, 1, 17),
      all_day: false,
      location: "Home",
      notes: "Maya",
      event_type: "childcare",
      recurrence_rule: "FREQ=WEEKLY;BYDAY=TU,TH",
      source_calendar: "babysitter",
      member_ids: [],
    }),
    base({
      id: "cov-2",
      title: "Babysitter",
      start_at: iso(mon, 4, 12),
      end_at: iso(mon, 4, 18),
      all_day: false,
      location: "Home",
      notes: "Maya — in-service day",
      event_type: "childcare",
      recurrence_rule: null,
      source_calendar: "babysitter",
      member_ids: [],
    }),
    base({
      id: "cov-3",
      title: "Babysitter",
      start_at: iso(mon, 5, 17),
      end_at: iso(mon, 5, 22),
      all_day: false,
      location: "Home",
      notes: "Date night",
      event_type: "childcare",
      recurrence_rule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
      source_calendar: "babysitter",
      member_ids: [],
    }),
  ].map(backdate);
}

export const SAMPLE_ACTIVITIES: FamilyActivity[] = [
  {
    id: "act-soccer",
    name: "Jack Soccer",
    member_ids: ["j"],
    schedule_label: "Tuesdays · 4:30–5:30 PM",
    location: "Riverside Fields",
    recurrence_rule: "FREQ=WEEKLY;BYDAY=TU",
    active: true,
  },
  {
    id: "act-dance",
    name: "Ellison Dance",
    member_ids: ["e"],
    schedule_label: "Wednesdays · 4:00–5:00 PM",
    location: "Studio 12",
    recurrence_rule: "FREQ=WEEKLY;BYDAY=WE",
    active: true,
  },
  {
    id: "act-school",
    name: "School",
    member_ids: ["b", "e", "j"],
    schedule_label: "Mon–Fri · 8:00 AM–3:00 PM",
    location: "Maplewood Elementary",
    recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    active: true,
  },
];

/* ------------------------------------------------------- recurrence expansion */

export interface Occurrence {
  key: string;
  event: CalendarEvent;
  start: Date;
  end: Date;
}

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function parseRule(rule: string | null) {
  if (!rule || rule === "CUSTOM") return null;
  const parts = Object.fromEntries(
    rule.split(";").map((p) => {
      const [k, v] = p.split("=");
      return [k, v ?? ""];
    }),
  );
  return {
    freq: parts["FREQ"] ?? "WEEKLY",
    interval: Number(parts["INTERVAL"] ?? 1) || 1,
    byDay: parts["BYDAY"] ? parts["BYDAY"].split(",") : null,
  };
}

function occursOn(event: CalendarEvent, day: Date): boolean {
  const start = new Date(event.start_at);
  const rule = parseRule(event.recurrence_rule);
  if (!rule) return isSameDay(start, day);
  if (differenceInCalendarDays(day, startOfDay(start)) < 0) return false;

  if (rule.freq === "DAILY") {
    return differenceInCalendarDays(day, startOfDay(start)) % rule.interval === 0;
  }
  if (rule.freq === "MONTHLY") {
    return day.getDate() === start.getDate();
  }
  // WEEKLY
  const days = rule.byDay ?? [DAY_CODES[start.getDay()]!];
  if (!days.includes(DAY_CODES[day.getDay()]!)) return false;
  const weeks = Math.abs(differenceInCalendarWeeks(day, start, { weekStartsOn: 1 }));
  return weeks % rule.interval === 0;
}

export function expandOccurrences(
  events: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): Occurrence[] {
  const result: Occurrence[] = [];
  const durationOf = (e: CalendarEvent) =>
    new Date(e.end_at).getTime() - new Date(e.start_at).getTime();

  for (let day = startOfDay(rangeStart); day <= rangeEnd; day = addDays(day, 1)) {
    for (const event of events) {
      if (!occursOn(event, day)) continue;
      const baseStart = new Date(event.start_at);
      const start = new Date(day);
      start.setHours(baseStart.getHours(), baseStart.getMinutes(), 0, 0);
      const end = new Date(start.getTime() + durationOf(event));
      result.push({ key: `${event.id}-${start.toISOString()}`, event, start, end });
    }
  }
  return result.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function occurrencesForDay(events: CalendarEvent[], day: Date): Occurrence[] {
  return expandOccurrences(events, startOfDay(day), addDays(startOfDay(day), 1));
}

export function isCoverage(event: CalendarEvent): boolean {
  return event.source_calendar === "babysitter";
}

export function matchesFilter(event: CalendarEvent, selected: MemberId[]): boolean {
  if (selected.length === 0) return true;
  return event.member_ids.some((id) => selected.includes(id));
}

export function formatTimeRange(start: Date, end: Date, allDay: boolean): string {
  if (allDay) return "All day";
  const fmt = (d: Date) =>
    d
      .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      .replace(":00", "")
      .toLowerCase();
  return `${fmt(start)}–${fmt(end)}`;
}
