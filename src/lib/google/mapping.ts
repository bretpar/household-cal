/**
 * Pure mapping between Our Family Calendar events and Google Calendar events.
 *
 * Nothing in this file talks to the network or the database, so every rule here
 * (recurrence branches, title generation, conflict resolution) is unit tested.
 *
 * Ownership rule that drives the whole design: Google owns only
 * Google-compatible fields (title text, times, all-day, location, description,
 * recurrence, cancellation). Family assignments, per-person weekday rules,
 * household permissions and every other app concept stay app-owned and are
 * never inferred from a Google title.
 */

import { WEEKDAY_CODES, type WeekdayCode } from "@/lib/family-data";

export type SyncSource = "app" | "google";

export interface GoogleDateTime {
  date?: string | null;
  dateTime?: string | null;
  timeZone?: string | null;
}

export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string | null;
  description?: string | null;
  location?: string | null;
  start?: GoogleDateTime;
  end?: GoogleDateTime;
  recurrence?: string[] | null;
  recurringEventId?: string | null;
  originalStartTime?: GoogleDateTime | null;
  etag?: string;
  updated?: string;
}

/** One Google recurrence series that represents part of a logical app event. */
export interface SyncBranch {
  /** stable id for the branch inside the logical event ("" = the whole event) */
  key: string;
  /** weekdays this branch runs on, or null when it follows the event's own rule */
  weekdays: WeekdayCode[] | null;
  /** app member ids participating on this branch */
  memberIds: string[];
}

export interface BranchEventLike {
  recurrence_rule: string | null;
  participants: { member_id: string; weekdays: WeekdayCode[] | null }[];
  member_ids: string[];
}

const ORDERED_CODES = WEEKDAY_CODES.map((w) => w.code);

function sortWeekdays(codes: WeekdayCode[]): WeekdayCode[] {
  return [...new Set(codes)].sort((a, b) => ORDERED_CODES.indexOf(a) - ORDERED_CODES.indexOf(b));
}

export function parseRuleWeekdays(rule: string | null): WeekdayCode[] | null {
  if (!rule) return null;
  const byday = /BYDAY=([^;]+)/i.exec(rule);
  if (!byday?.[1]) return null;
  const codes = byday[1]
    .split(",")
    .map((c) => c.trim().toUpperCase().slice(-2) as WeekdayCode)
    .filter((c) => ORDERED_CODES.includes(c));
  return codes.length > 0 ? sortWeekdays(codes) : null;
}

/**
 * Splits one logical app event into the Google series it needs.
 *
 * A School event where Bailey goes Mon–Thu and Ellison Tue–Thu becomes two
 * branches — Monday (B) and Tue/Wed/Thu (B & E) — because Google cannot express
 * "different people on different days" inside one series. Both branches keep
 * pointing at the same app event id through `event_sync_links.branch_key`.
 */
export function computeBranches(event: BranchEventLike): SyncBranch[] {
  const allMembers = [...event.member_ids].sort();
  const perPerson = event.participants.filter((p) => p.weekdays && p.weekdays.length > 0);

  if (!event.recurrence_rule || perPerson.length === 0) {
    return [{ key: "", weekdays: null, memberIds: allMembers }];
  }

  const ruleDays = parseRuleWeekdays(event.recurrence_rule);
  const candidateDays = sortWeekdays(
    ruleDays ?? (event.participants.flatMap((p) => p.weekdays ?? []) as WeekdayCode[]),
  );
  if (candidateDays.length === 0) {
    return [{ key: "", weekdays: null, memberIds: allMembers }];
  }

  // day -> the members that actually attend that day
  const byDay = new Map<WeekdayCode, string[]>();
  for (const day of candidateDays) {
    const members = event.participants
      .filter((p) => p.weekdays === null || p.weekdays.includes(day))
      .map((p) => p.member_id)
      .sort();
    if (members.length > 0) byDay.set(day, members);
  }

  // group days that share the exact same member set into one series
  const groups = new Map<string, { weekdays: WeekdayCode[]; memberIds: string[] }>();
  for (const [day, members] of byDay) {
    const signature = members.join("|");
    const existing = groups.get(signature);
    if (existing) existing.weekdays.push(day);
    else groups.set(signature, { weekdays: [day], memberIds: members });
  }

  if (groups.size === 0) return [{ key: "", weekdays: null, memberIds: allMembers }];

  return [...groups.values()]
    .map((g) => {
      const weekdays = sortWeekdays(g.weekdays);
      return { key: weekdays.join(","), weekdays, memberIds: g.memberIds };
    })
    .sort((a, b) => ORDERED_CODES.indexOf(a.weekdays![0]!) - ORDERED_CODES.indexOf(b.weekdays![0]!));
}

/** "School" + [B, E] -> "School - B & E". Initials come from the household. */
export function googleTitle(title: string, initials: string[]): string {
  const clean = title.trim();
  if (initials.length === 0) return clean;
  return `${clean} - ${initials.join(" & ")}`;
}

/**
 * Removes an app-generated " - B & E" suffix so an untouched Google title maps
 * back to the plain app title. A renamed title ("Late Start") passes through
 * unchanged — and the member assignment is never re-derived from it.
 */
export function stripGeneratedSuffix(summary: string, initials: string[]): string {
  const suffix = initials.length > 0 ? ` - ${initials.join(" & ")}` : "";
  if (suffix && summary.endsWith(suffix)) return summary.slice(0, -suffix.length).trim();
  return summary.trim();
}

function untilStamp(untilDay: string): string {
  return `${untilDay.replace(/-/g, "")}T235959Z`;
}

/** App rule + branch weekdays -> Google RRULE/EXDATE lines. */
export function toGoogleRecurrence(
  rule: string | null,
  branchWeekdays: WeekdayCode[] | null,
  recurrenceUntil: string | null,
  excludedDates: string[] = [],
): string[] | null {
  if (!rule) return null;
  const parts = rule
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && !/^BYDAY=/i.test(p) && !/^UNTIL=/i.test(p));
  if (branchWeekdays && branchWeekdays.length > 0) parts.push(`BYDAY=${branchWeekdays.join(",")}`);
  if (recurrenceUntil) parts.push(`UNTIL=${untilStamp(recurrenceUntil)}`);
  const lines = [`RRULE:${parts.join(";")}`];
  if (excludedDates.length > 0) {
    lines.push(`EXDATE;VALUE=DATE:${excludedDates.map((d) => d.replace(/-/g, "")).join(",")}`);
  }
  return lines;
}

export interface ParsedGoogleRecurrence {
  rule: string | null;
  weekdays: WeekdayCode[] | null;
  until: string | null;
  excludedDates: string[];
}

/** Google RRULE/EXDATE lines -> the app's simplified rule shape. */
export function fromGoogleRecurrence(lines: string[] | null | undefined): ParsedGoogleRecurrence {
  const empty: ParsedGoogleRecurrence = {
    rule: null,
    weekdays: null,
    until: null,
    excludedDates: [],
  };
  if (!lines || lines.length === 0) return empty;

  const rrule = lines.find((l) => l.toUpperCase().startsWith("RRULE:"));
  const exdates = lines.filter((l) => l.toUpperCase().startsWith("EXDATE"));
  const excludedDates = exdates.flatMap((line) => {
    const value = line.split(":")[1] ?? "";
    return value
      .split(",")
      .map((v) => v.trim().slice(0, 8))
      .filter((v) => /^\d{8}$/.test(v))
      .map((v) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`);
  });
  if (!rrule) return { ...empty, excludedDates };

  const body = rrule.slice(rrule.indexOf(":") + 1);
  const keep: string[] = [];
  let until: string | null = null;
  let weekdays: WeekdayCode[] | null = null;

  for (const part of body.split(";")) {
    const [rawKey, rawValue = ""] = part.split("=");
    const key = (rawKey ?? "").toUpperCase();
    if (key === "UNTIL") {
      const stamp = rawValue.slice(0, 8);
      if (/^\d{8}$/.test(stamp)) {
        until = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
      }
      continue;
    }
    if (key === "BYDAY") {
      weekdays = parseRuleWeekdays(`BYDAY=${rawValue}`);
      continue;
    }
    if (key === "FREQ" || key === "INTERVAL" || key === "COUNT") keep.push(`${key}=${rawValue}`);
  }

  return { rule: keep.length > 0 ? keep.join(";") : null, weekdays, until, excludedDates };
}

/** ISO instant / all-day date pair for a Google event body. */
export function toGoogleTimes(
  startAt: string,
  endAt: string,
  allDay: boolean,
  timeZone: string,
): { start: GoogleDateTime; end: GoogleDateTime } {
  if (allDay) {
    const start = startAt.slice(0, 10);
    const endDay = endAt.slice(0, 10);
    // Google's all-day end date is exclusive
    const exclusive = endDay <= start ? addOneDay(start) : addOneDay(endDay);
    return { start: { date: start }, end: { date: exclusive } };
  }
  return {
    start: { dateTime: new Date(startAt).toISOString(), timeZone },
    end: { dateTime: new Date(endAt).toISOString(), timeZone },
  };
}

function addOneDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function subtractOneDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function fromGoogleTimes(event: GoogleEvent): {
  start_at: string;
  end_at: string;
  all_day: boolean;
} {
  const startDate = event.start?.date;
  const endDate = event.end?.date;
  if (startDate) {
    const lastDay = endDate ? subtractOneDay(endDate) : startDate;
    return {
      start_at: `${startDate}T00:00:00.000Z`,
      end_at: `${(lastDay < startDate ? startDate : lastDay)}T23:59:59.000Z`,
      all_day: true,
    };
  }
  const start = event.start?.dateTime ?? new Date().toISOString();
  const end = event.end?.dateTime ?? start;
  return {
    start_at: new Date(start).toISOString(),
    end_at: new Date(end).toISOString(),
    all_day: false,
  };
}

export interface LinkVersionState {
  google_etag: string | null;
  google_updated_at: string | null;
  last_source: SyncSource;
  last_pushed_at: string | null;
}

/** Local app-side state used to decide whether a local edit is still unsynced. */
export interface LocalEventState {
  updated_at: string | null;
  last_change_source?: string | null;
}

/**
 * Newest valid change wins, with loop protection.
 *
 * - Same etag as the one we stored after our own push => Google is echoing our
 *   change back, so ignore it.
 * - Google's `updated` older than or equal to what we already processed means a
 *   stale/duplicate notification: ignore it.
 * - A local change only beats an inbound Google change when it is genuinely
 *   *unsynced*: the app made the last local change AND that change happened
 *   after our last successful push. A push timestamp alone (or a local
 *   `updated_at` bumped by our own push bookkeeping) is never treated as proof
 *   that the app version is newer.
 */
export function shouldApplyGoogleChange(
  link: LinkVersionState | null,
  incoming: { etag?: string | undefined; updated?: string | undefined },
  local: LocalEventState | string | null,
): boolean {
  if (!link) return true;
  if (incoming.etag && link.google_etag && incoming.etag === link.google_etag) return false;
  const incomingTime = incoming.updated ? Date.parse(incoming.updated) : NaN;
  if (Number.isNaN(incomingTime)) return true;

  const processed = link.google_updated_at ? Date.parse(link.google_updated_at) : 0;
  if (incomingTime <= processed) return false;

  const localState: LocalEventState | null =
    typeof local === "string" ? { updated_at: local } : local;
  if (!localState?.updated_at) return true;
  if (localState.last_change_source !== "app") return true;

  const localTime = Date.parse(localState.updated_at);
  const pushedAt = link.last_pushed_at ? Date.parse(link.last_pushed_at) : NaN;
  // already pushed => the app edit is synced, so a newer Google edit wins
  if (!Number.isNaN(pushedAt) && localTime <= pushedAt) return true;

  return !(localTime > incomingTime);
}


/** ±3 months on first import, +3 months for ongoing work. */
export function syncWindow(now = new Date(), initial = false): { timeMin: string; timeMax: string } {
  const min = new Date(now);
  min.setMonth(min.getMonth() - (initial ? 3 : 1));
  const max = new Date(now);
  max.setMonth(max.getMonth() + 3);
  return { timeMin: min.toISOString(), timeMax: max.toISOString() };
}
