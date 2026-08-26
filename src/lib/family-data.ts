/**
 * Household-agnostic calendar domain model.
 *
 * Shapes mirror the database tables (families / family_users / family_members /
 * calendar_sources / events / event_members / activities). Nothing in this file
 * assumes a particular household, member set, initial, color or calendar name —
 * every value is derived from database records at runtime.
 */

import {
  addDays,
  differenceInCalendarDays,
  differenceInCalendarWeeks,
  isSameDay,
  startOfDay,
  startOfWeek,
} from "date-fns";

export type MemberId = string;
export type FamilyId = string;

export type FamilyRole = "owner" | "editor" | "viewer";
export type MemberRole = "parent" | "child" | "caregiver" | "other";
export type AccessLevel = "full" | "view_only";

export type EventType =
  | "school"
  | "activity"
  | "work"
  | "childcare"
  | "appointment"
  | "family"
  | "other";

export type DisplayMode = "events" | "coverage_background";
export type CalendarProvider = "local" | "google";

/** Palette keys a household can assign to its own members. */
export type MemberColor =
  | "sky"
  | "rose"
  | "amber"
  | "sage"
  | "teal"
  | "lilac"
  | "coral"
  | "sand";

export interface Family {
  id: FamilyId;
  name: string;
  role: FamilyRole;
}

export interface FamilyMember {
  id: MemberId;
  family_id: FamilyId;
  name: string;
  initial: string;
  color: MemberColor;
  role: MemberRole;
  access: AccessLevel;
  active: boolean;
  sort_order: number;
}

export interface CalendarSource {
  id: string;
  family_id: FamilyId;
  name: string;
  provider: CalendarProvider;
  external_calendar_id: string | null;
  display_mode: DisplayMode;
  active: boolean;
  /** New events default to the main connected calendar. */
  is_main: boolean;
}

/** Weekday code used by RRULE BYDAY and by per-person participation rules. */
export type WeekdayCode = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export const WEEKDAY_CODES: { code: WeekdayCode; short: string; label: string }[] = [
  { code: "MO", short: "Mon", label: "Monday" },
  { code: "TU", short: "Tue", label: "Tuesday" },
  { code: "WE", short: "Wed", label: "Wednesday" },
  { code: "TH", short: "Thu", label: "Thursday" },
  { code: "FR", short: "Fri", label: "Friday" },
  { code: "SA", short: "Sat", label: "Saturday" },
  { code: "SU", short: "Sun", label: "Sunday" },
];

/**
 * One participant inside a series. `weekdays === null` means "every occurrence";
 * a list restricts that person to those weekdays only, so a single School series
 * can hold Bailey Mon–Thu and Ellison Tue–Thu.
 */
export interface EventParticipant {
  member_id: MemberId;
  weekdays: WeekdayCode[] | null;
}

export interface CalendarEvent {
  id: string;
  family_id: FamilyId;
  calendar_source_id: string | null;
  /** resolved from the event's calendar source — drives coverage vs. event rendering */
  display_mode: DisplayMode;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  notes: string | null;
  event_type: EventType;
  /** simplified RRULE, null = single event */
  recurrence_rule: string | null;
  /** yyyy-MM-dd last day the series may occur — mirrors RRULE UNTIL */
  recurrence_until: string | null;
  /** yyyy-MM-dd dates removed from the series — mirrors Google EXDATE */
  excluded_dates: string[];
  /** optional household category; null = the system Uncategorized state */
  category_id: string | null;
  external_event_id: string | null;

  external_recurring_event_id: string | null;
  /** every member on the series, with their own weekday rule */
  participants: EventParticipant[];
  /** every member on the series, ignoring weekday rules */
  member_ids: MemberId[];
  /** true for events imported from Google that nobody has been assigned to yet */
  needs_family_assignment: boolean;
  /** ISO timestamp the row was created — powers "recently added" ordering */
  created_at?: string | null;
}



export interface FamilyActivity {
  id: string;
  family_id: FamilyId;
  name: string;
  event_type: EventType;
  location: string | null;
  schedule_label: string | null;
  recurrence_rule: string | null;
  active: boolean;
  member_ids: MemberId[];
}

/**
 * The single canonical "Activity" concept for an event. Stored as `event_type`
 * for data compatibility; always presented to users as "Activity".
 */
export const EVENT_TYPES: { id: EventType; label: string }[] = [
  { id: "school", label: "School" },
  { id: "activity", label: "Activity" },
  { id: "work", label: "Work" },
  { id: "childcare", label: "Childcare" },
  { id: "appointment", label: "Appointment" },
  { id: "family", label: "Family" },
  { id: "other", label: "Other" },
];

/** Canonical display label for the Activity concept, whatever the source of the event. */
export function activityLabel(type: EventType | string | null | undefined): string {
  return EVENT_TYPES.find((t) => t.id === type)?.label ?? "Other";
}

export const RECURRENCE_OPTIONS = [
  { id: "none", label: "Does not repeat", rule: null },
  { id: "daily", label: "Daily", rule: "FREQ=DAILY" },
  { id: "weekly", label: "Weekly", rule: "FREQ=WEEKLY" },
  { id: "biweekly", label: "Every 2 weeks", rule: "FREQ=WEEKLY;INTERVAL=2" },
  { id: "monthly", label: "Monthly", rule: "FREQ=MONTHLY" },
  { id: "custom", label: "Custom days by person", rule: "CUSTOM" },
] as const;

export interface MemberStyle {
  badge: string;
  soft: string;
  ring: string;
  dot: string;
}

/**
 * Static class map so Tailwind can see every palette utility.
 * Badge text uses the palette's own dark "ink" shade for contrast on pastels.
 */
export const MEMBER_PALETTE: Record<MemberColor, MemberStyle> = {
  sky: {
    badge: "bg-member-sky text-member-sky-ink",
    soft: "bg-member-sky-soft",
    ring: "ring-member-sky",
    dot: "bg-member-sky",
  },
  rose: {
    badge: "bg-member-rose text-member-rose-ink",
    soft: "bg-member-rose-soft",
    ring: "ring-member-rose",
    dot: "bg-member-rose",
  },
  amber: {
    badge: "bg-member-amber text-member-amber-ink",
    soft: "bg-member-amber-soft",
    ring: "ring-member-amber",
    dot: "bg-member-amber",
  },
  sage: {
    badge: "bg-member-sage text-member-sage-ink",
    soft: "bg-member-sage-soft",
    ring: "ring-member-sage",
    dot: "bg-member-sage",
  },
  teal: {
    badge: "bg-member-teal text-member-teal-ink",
    soft: "bg-member-teal-soft",
    ring: "ring-member-teal",
    dot: "bg-member-teal",
  },
  lilac: {
    badge: "bg-member-lilac text-member-lilac-ink",
    soft: "bg-member-lilac-soft",
    ring: "ring-member-lilac",
    dot: "bg-member-lilac",
  },
  coral: {
    badge: "bg-member-coral text-member-coral-ink",
    soft: "bg-member-coral-soft",
    ring: "ring-member-coral",
    dot: "bg-member-coral",
  },
  sand: {
    badge: "bg-member-sand text-member-sand-ink",
    soft: "bg-member-sand-soft",
    ring: "ring-member-sand",
    dot: "bg-member-sand",
  },
};

export const MEMBER_COLORS = Object.keys(MEMBER_PALETTE) as MemberColor[];

export const FALLBACK_MEMBER_STYLE: MemberStyle = {
  badge: "bg-surface-muted text-muted-foreground",
  soft: "bg-surface-muted",
  ring: "ring-border",
  dot: "bg-border",
};

export function styleForColor(color: string | undefined): MemberStyle {
  return MEMBER_PALETTE[(color ?? "") as MemberColor] ?? FALLBACK_MEMBER_STYLE;
}

/** id -> style map for a household's own members. */
export function buildMemberStyles(members: FamilyMember[]): Record<MemberId, MemberStyle> {
  return Object.fromEntries(members.map((m) => [m.id, styleForColor(m.color)]));
}

/** Monday of the given week — views are Monday-first. */
export function anchorMonday(today = new Date()): Date {
  return startOfWeek(today, { weekStartsOn: 1 });
}

/* ------------------------------------------------------- recurrence expansion */

export interface Occurrence {
  key: string;
  event: CalendarEvent;
  start: Date;
  end: Date;
  /** members taking part on this specific day (per-person weekday rules applied) */
  member_ids: MemberId[];
}


const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export interface ParsedRule {
  freq: string;
  interval: number;
  byDay: string[] | null;
  count: number | null;
}

export function parseRecurrenceRule(rule: string | null): ParsedRule | null {
  if (!rule || rule === "CUSTOM") return null;
  const parts = Object.fromEntries(
    rule.split(";").map((p) => {
      const [k, v] = p.split("=");
      return [k, v ?? ""];
    }),
  );
  const count = Number(parts["COUNT"] ?? 0);
  return {
    freq: parts["FREQ"] ?? "WEEKLY",
    interval: Number(parts["INTERVAL"] ?? 1) || 1,
    byDay: parts["BYDAY"] ? parts["BYDAY"].split(",") : null,
    count: count > 0 ? count : null,
  };
}

const parseRule = parseRecurrenceRule;

/** Builds a rule string, folding an occurrence count into it when present. */
export function withRecurrenceCount(rule: string | null, count: number | null): string | null {
  if (!rule || rule === "CUSTOM") return rule;
  const base = rule
    .split(";")
    .filter((p) => !p.startsWith("COUNT="))
    .join(";");
  return count && count > 0 ? `${base};COUNT=${Math.floor(count)}` : base;
}

/** yyyy-MM-dd key used for EXDATE / UNTIL comparisons. */
export function dayKey(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

/** Zero-based index of a day inside the series, or null when it isn't a hit. */
function occurrenceIndex(start: Date, day: Date, rule: ParsedRule): number | null {
  if (rule.freq === "DAILY") {
    const diff = differenceInCalendarDays(day, startOfDay(start));
    return diff % rule.interval === 0 ? diff / rule.interval : null;
  }
  if (rule.freq === "MONTHLY") {
    if (day.getDate() !== start.getDate()) return null;
    const months =
      (day.getFullYear() - start.getFullYear()) * 12 + (day.getMonth() - start.getMonth());
    return months % rule.interval === 0 ? months / rule.interval : null;
  }
  // WEEKLY
  const days = rule.byDay ?? [DAY_CODES[start.getDay()]!];
  if (!days.includes(DAY_CODES[day.getDay()]!)) return null;
  const weeks = Math.abs(differenceInCalendarWeeks(day, start, { weekStartsOn: 1 }));
  if (weeks % rule.interval !== 0) return null;
  const cycles = weeks / rule.interval;
  const perCycle = days.length;
  const orderInWeek = [...days]
    .sort((a, b) => DAY_CODES.indexOf(a) - DAY_CODES.indexOf(b))
    .indexOf(DAY_CODES[day.getDay()]!);
  return cycles * perCycle + orderInWeek;
}

function occursOn(event: CalendarEvent, day: Date): boolean {
  const start = new Date(event.start_at);
  const rule = parseRule(event.recurrence_rule);
  if (event.excluded_dates?.includes(dayKey(day))) return false;
  if (event.recurrence_until && dayKey(day) > event.recurrence_until) return false;
  if (!rule) return isSameDay(start, day);
  if (differenceInCalendarDays(day, startOfDay(start)) < 0) return false;

  const index = occurrenceIndex(start, day, rule);
  if (index === null) return false;
  if (rule.count !== null && index >= rule.count) return false;
  return true;
}

/**
 * Who takes part on a given day. Members without a weekday rule always take
 * part; members with one only appear on their own weekdays.
 */
export function participantsOn(event: CalendarEvent, day: Date): MemberId[] {
  const code = DAY_CODES[day.getDay()] as WeekdayCode;
  const source =
    event.participants.length > 0
      ? event.participants
      : event.member_ids.map((member_id) => ({ member_id, weekdays: null }));
  return source
    .filter((p) => !p.weekdays || p.weekdays.length === 0 || p.weekdays.includes(code))
    .map((p) => p.member_id);
}

/** True when at least one person is scheduled — no empty School days. */
function hasParticipantsOn(event: CalendarEvent, day: Date): boolean {
  const hasRules = event.participants.some((p) => p.weekdays && p.weekdays.length > 0);
  if (!hasRules) return true;
  return participantsOn(event, day).length > 0;
}

/** Plain-language summary of one person's weekdays, e.g. "Mon, Tue, Wed". */
export function describeWeekdays(weekdays: WeekdayCode[] | null): string {
  if (!weekdays || weekdays.length === 0) return "Every day of the series";
  const order = WEEKDAY_CODES.map((d) => d.code);
  return [...weekdays]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((code) => WEEKDAY_CODES.find((d) => d.code === code)?.short ?? code)
    .join(", ");
}

/** Plain-language summary such as "Repeats every Monday until December 14, 2026". */
export function describeRecurrence(event: CalendarEvent): string | null {
  const rule = parseRule(event.recurrence_rule);
  if (!rule) return event.recurrence_rule === "CUSTOM" ? "Repeats on a custom schedule" : null;

  const start = new Date(event.start_at);
  const weekday = start.toLocaleDateString("en-US", { weekday: "long" });
  let base: string;
  if (rule.freq === "DAILY") {
    base = rule.interval === 1 ? "Repeats daily" : `Repeats every ${rule.interval} days`;
  } else if (rule.freq === "MONTHLY") {
    base =
      rule.interval === 1
        ? `Repeats monthly on day ${start.getDate()}`
        : `Repeats every ${rule.interval} months`;
  } else {
    base = rule.interval === 1 ? `Repeats every ${weekday}` : `Repeats every ${rule.interval} weeks`;
  }

  if (event.recurrence_until) {
    const [y, m, d] = event.recurrence_until.split("-").map(Number);
    const until = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
    return `${base} until ${until.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
  }
  if (rule.count !== null) {
    return `${base} · ${rule.count} occurrence${rule.count === 1 ? "" : "s"}`;
  }
  return base;
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
      if (!hasParticipantsOn(event, day)) continue;
      const baseStart = new Date(event.start_at);
      const start = new Date(day);
      start.setHours(baseStart.getHours(), baseStart.getMinutes(), 0, 0);
      const end = new Date(start.getTime() + durationOf(event));
      result.push({
        key: `${event.id}-${start.toISOString()}`,
        event,
        start,
        end,
        member_ids: participantsOn(event, day),
      });
    }
  }
  return result.sort((a, b) => a.start.getTime() - b.start.getTime());
}


export function occurrencesForDay(events: CalendarEvent[], day: Date): Occurrence[] {
  return expandOccurrences(events, startOfDay(day), addDays(startOfDay(day), 1));
}

/** Coverage rendering is decided by the calendar source's display mode, never by its name. */
export function isCoverage(event: CalendarEvent): boolean {
  return event.display_mode === "coverage_background";
}

export function matchesFilter(event: CalendarEvent, selected: MemberId[]): boolean {
  if (selected.length === 0) return true;
  return event.member_ids.some((id) => selected.includes(id));
}

/** Filtering respects who is actually scheduled on that day. */
export function occurrenceMatchesFilter(occurrence: Occurrence, selected: MemberId[]): boolean {
  if (selected.length === 0) return true;
  return occurrence.member_ids.some((id) => selected.includes(id));
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
