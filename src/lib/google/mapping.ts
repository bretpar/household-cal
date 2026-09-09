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
import { isIanaTimeZone } from "./timezone";

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

/**
 * The canonical weekday set of a per-person recurring event: the union of the
 * weekdays currently assigned to members.
 *
 * Membership edits are the source of truth. Without this, removing or adding a
 * person leaves the stored BYDAY carrying weekdays nobody attends any more
 * (typically the original start weekday), which Google then keeps emitting.
 */
export function canonicalRecurrenceRule(
  rule: string | null,
  memberWeekdays: Record<string, string[] | null | undefined> | null | undefined,
): string | null {
  if (!rule) return rule;
  const union = sortWeekdays(
    Object.values(memberWeekdays ?? {})
      .flatMap((days) => (days ?? []) as WeekdayCode[])
      .filter((code) => ORDERED_CODES.includes(code)),
  );
  if (union.length === 0) return rule;
  const parts = rule
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && !/^BYDAY=/i.test(p));
  parts.push(`BYDAY=${union.join(",")}`);
  return parts.join(";");
}

/**
 * Weekdays a branch should be pushed with. A single shared branch inherits the
 * rule's BYDAY so its Google series is anchored to an active weekday instead of
 * a stale start weekday that would show up as one extra occurrence.
 */
export function branchPushWeekdays(
  branchWeekdays: WeekdayCode[] | null,
  rule: string | null,
): WeekdayCode[] | null {
  if (branchWeekdays && branchWeekdays.length > 0) return branchWeekdays;
  return parseRuleWeekdays(rule);
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

/**
 * Timed series need DATE-TIME exclusions: Google ignores a date-only EXDATE
 * against a timed DTSTART, so the occurrence keeps rendering. `timed` carries
 * the series start instant and household zone used to rebuild each occurrence's
 * local wall-clock time. All-day series keep date-only EXDATE.
 */
export interface TimedExdateContext {
  startAt: string;
  timeZone: string;
}

/** App rule + branch weekdays -> Google RRULE/EXDATE lines. */
export function toGoogleRecurrence(
  rule: string | null,
  branchWeekdays: WeekdayCode[] | null,
  recurrenceUntil: string | null,
  excludedDates: string[] = [],
  timed: TimedExdateContext | null = null,
): string[] | null {
  if (!rule) return null;
  const parts = rule
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && !/^BYDAY=/i.test(p) && !/^UNTIL=/i.test(p));
  // Branch-specific weekdays override the stored BYDAY; otherwise preserve it.
  if (branchWeekdays && branchWeekdays.length > 0) {
    parts.push(`BYDAY=${branchWeekdays.join(",")}`);
  } else {
    const storedByday = rule.split(";").map((p) => p.trim()).find((p) => /^BYDAY=/i.test(p));
    if (storedByday) parts.push(storedByday);
  }
  if (recurrenceUntil) parts.push(`UNTIL=${untilStamp(recurrenceUntil)}`);
  const lines = [`RRULE:${parts.join(";")}`];
  if (excludedDates.length > 0) {
    if (timed) {
      // TZID-qualified local DATE-TIME: the excluded day at the series' local
      // clock time, so DST shifts are handled by the zone itself.
      const clock = localWallClock(timed.startAt, timed.timeZone).slice(11).replace(/:/g, "");
      const values = excludedDates.map((d) => `${d.replace(/-/g, "")}T${clock}`).join(",");
      lines.push(`EXDATE;TZID=${timed.timeZone}:${values}`);
    } else {
      lines.push(`EXDATE;VALUE=DATE:${excludedDates.map((d) => d.replace(/-/g, "")).join(",")}`);
    }
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

/**
 * Canonical local `recurrence_rule` for an imported Google series.
 *
 * Google's BYDAY selection is part of the schedule, not decoration: dropping it
 * makes local expansion fall back to the start weekday only, so a WE,TH series
 * would render Wednesdays alone. Kept in one helper so both a brand-new import
 * and an update of an existing series serialize the rule identically.
 */
export function localRuleFromGoogle(
  rec: Pick<ParsedGoogleRecurrence, "rule" | "weekdays">,
): string | null {
  if (!rec.rule) return null;
  const parts = rec.rule
    .replace(/^RRULE:/i, "")
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  const hasByday = parts.some((p) => /^BYDAY=/i.test(p));
  if (!hasByday && rec.weekdays && rec.weekdays.length > 0) {
    parts.push(`BYDAY=${rec.weekdays.join(",")}`);
  }
  return parts.length > 0 ? parts.join(";") : null;
}

/**
 * Wall-clock string (`yyyy-MM-ddTHH:mm:ss`) for an instant in an IANA zone.
 *
 * Google interprets a floating dateTime plus `timeZone` as a local wall-clock
 * time, so recurring series keep their clock time across DST transitions.
 */
export function localWallClock(instant: string, timeZone: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return instant;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}`;
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
  // floating local time + IANA zone: Google re-applies the zone's offset for
  // every occurrence, so 9:00 AM stays 9:00 AM after a DST change
  return {
    start: { dateTime: localWallClock(startAt, timeZone), timeZone },
    end: { dateTime: localWallClock(endAt, timeZone), timeZone },
  };
}


const DTSTART_DAY_CODES: WeekdayCode[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Weekday of an instant, read in the given zone (UTC when none is supplied). */
function weekdayIndexIn(date: Date, timeZone?: string | null): number {
  if (!timeZone) return date.getUTCDay();
  const label = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  const idx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
  return idx === -1 ? date.getUTCDay() : idx;
}

/**
 * Anchors a per-person weekday branch to its own first occurrence.
 *
 * The shared local series keeps one start date, but each Google branch has its
 * own BYDAY set: pushing the shared DTSTART would make Google emit the branch
 * on the parent's weekday too. This shifts start and end forward by the same
 * whole number of days, so time of day, duration and all-day behaviour are
 * preserved and the shared local series is never modified.
 *
 * `timeZone` is the household zone for timed events: the weekday Google sees is
 * the local one, so anchoring on the UTC weekday would land the series a day
 * off (an evening event stored as the next UTC day) and emit an occurrence on a
 * weekday nobody attends. All-day series omit it and stay on UTC dates.
 */
export function branchAnchoredTimes(
  startAt: string,
  endAt: string,
  branchWeekdays: WeekdayCode[] | null,
  timeZone?: string | null,
): { startAt: string; endAt: string } {
  if (!branchWeekdays || branchWeekdays.length === 0) return { startAt, endAt };
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return { startAt, endAt };
  const allowed = new Set(branchWeekdays);
  const from = weekdayIndexIn(start, timeZone);
  let shift = 0;
  while (shift < 7 && !allowed.has(DTSTART_DAY_CODES[(from + shift) % 7]!)) shift += 1;
  if (shift === 0 || shift === 7) return { startAt, endAt };
  const ms = shift * 86400000;
  const end = new Date(endAt);
  return {
    startAt: new Date(start.getTime() + ms).toISOString(),
    endAt: Number.isNaN(end.getTime()) ? endAt : new Date(end.getTime() + ms).toISOString(),
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

/**
 * Fields for the detached local event that represents a Google-edited single
 * occurrence of an app-created series.
 *
 * The Google-generated " - B & E" suffix is stripped and the branch's family
 * assignments are inherited, so an externally edited occurrence never comes back
 * as an unassigned "needs family assignment" import.
 */
export function exceptionEventFields(input: {
  parent: { title: string; event_type: string };
  branch: SyncBranch;
  branchInitials: string[];
  google: GoogleEvent;
}): {
  title: string;
  event_type: string;
  member_ids: string[];
  needs_family_assignment: boolean;
  start_at: string;
  end_at: string;
  all_day: boolean;
} {
  const { parent, branch, branchInitials, google } = input;
  const times = fromGoogleTimes(google);
  const raw = google.summary ?? parent.title;
  const title = stripGeneratedSuffix(raw, branchInitials) || parent.title;
  return {
    title,
    event_type: parent.event_type,
    member_ids: [...branch.memberIds],
    needs_family_assignment: branch.memberIds.length === 0,
    ...times,
  };
}

/**
 * The patch applied to an already-linked local series when Google reports a
 * whole-series edit.
 *
 * Google carries no structured family data, so this only ever returns the
 * Google-owned fields. `event_members`, per-person weekdays, event type and the
 * review flag are app-owned and are deliberately absent from the patch, which
 * means an external time or title change can never clear the assignments.
 *
 * `omitTimes` is set by the caller when a branch-specific time edit arrived:
 * the branches share one local start/end, so the time must stay untouched.
 */
export function seriesPatchFromGoogle(input: {
  local: {
    title: string;
    memberCount: number;
    branchKey: string;
  };
  branchInitials: string[];
  google: GoogleEvent;
  omitTimes?: boolean;
  omitTitle?: boolean;
}): Record<string, unknown> {
  const { local, branchInitials, google, omitTimes = false, omitTitle = false } = input;
  const times = fromGoogleTimes(google);
  const raw = google.summary ?? local.title;
  const title = stripGeneratedSuffix(raw, branchInitials) || local.title;
  const patch: Record<string, unknown> = {
    location: google.location ?? null,
    notes: google.description ?? null,
    last_change_source: "google",
  };
  // a renamed branch only owns itself, so it must not rewrite the shared title
  if (!omitTitle) patch["title"] = title;
  if (!omitTimes) {
    patch["start_at"] = times.start_at;
    patch["end_at"] = times.end_at;
    patch["all_day"] = times.all_day;
  }
  // a branch only owns its own weekdays, so it must not rewrite the shared rule
  // for the other branches of the same logical event
  if (local.branchKey === "") {
    const rec = fromGoogleRecurrence(google.recurrence);
    patch["recurrence_rule"] = localRuleFromGoogle(rec);
    patch["recurrence_until"] = rec.until;
    if (rec.excludedDates.length > 0) patch["excluded_dates"] = rec.excludedDates;
  }
  // an assigned event stays assigned; only a genuinely memberless one is flagged
  if (local.memberCount > 0) patch["needs_family_assignment"] = false;
  return patch;
}

/**
 * Wording shown on the affected link when one branch's series title was
 * renamed directly in Google.
 */
export const BRANCH_TITLE_REVIEW_MESSAGE =
  "Branch-specific series title edits made in Google are not supported for events with per-person day schedules. The local title was left unchanged — please edit it in the app.";

/**
 * A whole-series title edit made in Google on one branch of a per-person
 * weekday series cannot be mapped back: every branch reads the same local
 * `events.title`, so applying Mom's renamed "WE" series would also retitle
 * Dad's Mondays.
 *
 * Returns the review wording when the inbound branch's normalized title (with
 * the app-generated member-initial suffix stripped) diverges from the shared
 * local title, otherwise null. Purely comparative — never mutates anything
 * and stays stable across re-syncs.
 */
export function branchTitleReview(input: {
  local: { branchKey: string; title: string };
  branchInitials: string[];
  google: GoogleEvent;
}): string | null {
  const { local, branchInitials, google } = input;
  if (!local.branchKey) return null;
  // single-occurrence exceptions are detached and keep their own title
  if (google.recurringEventId) return null;
  const raw = google.summary ?? local.title;
  const incoming = stripGeneratedSuffix(raw, branchInitials) || local.title;
  if (incoming === local.title) return null;
  return BRANCH_TITLE_REVIEW_MESSAGE;
}

/**
 * Wording shown on the affected link when one branch's series time was edited
 * directly in Google.
 */
export const BRANCH_TIME_REVIEW_MESSAGE =
  "Branch-specific series time edits made in Google are not supported for events with per-person day schedules. The local time was left unchanged — please edit it in the app.";

/** Time-of-day + duration fingerprint, ignoring the branch's anchor date. */
function clockSignature(startAt: string, endAt: string, allDay: boolean): string | null {
  if (allDay) return "all-day";
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return `${start.toISOString().slice(11, 19)}|${end.getTime() - start.getTime()}`;
}

/**
 * A whole-series time edit made in Google on one branch of a per-person weekday
 * series cannot be mapped back: every branch reads the same local start/end, so
 * applying Mom's 5–6 PM would also move Dad's Mondays.
 *
 * Returns the review wording when such an edit arrived, otherwise null. Purely
 * comparative — it never mutates anything and stays stable across re-syncs.
 */
export function branchTimeReview(input: {
  local: { branchKey: string; start_at: string; end_at: string; all_day: boolean };
  google: GoogleEvent;
}): string | null {
  const { local, google } = input;
  if (!local.branchKey) return null;
  // single-occurrence exceptions are detached and keep their own time
  if (google.recurringEventId) return null;
  const incoming = fromGoogleTimes(google);
  if (incoming.all_day !== local.all_day) return BRANCH_TIME_REVIEW_MESSAGE;
  const localSig = clockSignature(local.start_at, local.end_at, local.all_day);
  const incomingSig = clockSignature(incoming.start_at, incoming.end_at, incoming.all_day);
  if (!localSig || !incomingSig || localSig === incomingSig) return null;
  return BRANCH_TIME_REVIEW_MESSAGE;
}


/** Frequency/interval part of a rule, ignoring the per-branch BYDAY selection. */
function sharedRuleShape(rule: string | null | undefined): string {
  if (!rule) return "";
  return rule
    .replace(/^RRULE:/i, "")
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && !/^BYDAY=/i.test(p))
    .map((p) => p.toUpperCase())
    .sort()
    .join(";");
}

/**
 * A recurrence/end-date edit made in Google on one branch of a custom
 * per-person weekday series cannot be mapped back safely: the branches share a
 * single local rule, so applying one branch's change would silently rewrite the
 * schedule of the other branches.
 *
 * Returns a human-readable reason when such an edit is detected (so the series
 * can be flagged for review) or `null` when nothing conflicting arrived.
 * Never mutates or returns a patch — the local recurrence is left untouched.
 */
export function branchRecurrenceReview(input: {
  local: { branchKey: string; recurrence_rule: string | null; recurrence_until: string | null };
  google: GoogleEvent;
}): string | null {
  const { local, google } = input;
  if (!local.branchKey) return null;
  if (!google.recurrence || google.recurrence.length === 0) return null;

  const incoming = fromGoogleRecurrence(google.recurrence);
  const ruleChanged = sharedRuleShape(incoming.rule) !== sharedRuleShape(local.recurrence_rule);
  const untilChanged = (incoming.until ?? null) !== (local.recurrence_until ?? null);
  if (!ruleChanged && !untilChanged) return null;

  return "Recurrence/end-date edits made in Google are not supported for events with per-person day schedules. The local schedule was left unchanged — please review and edit it in the app.";
}


/** What a pulled `status: "cancelled"` item may do to the linked local event. */
export type CancellationAction = "ignore" | "remove";


/**
 * Decides whether a Google cancellation tombstone may remove local data.
 *
 * A tombstone is only honoured when it refers to the same Google event *in the
 * same connected calendar* as the link, and only when Google confirms that event
 * is really cancelled or gone. Tombstones left behind by a cross-calendar move,
 * or stale entries replayed by a full/incremental list, are ignored so a valid
 * local event can never be deleted by accident.
 */
export function cancellationAction(input: {
  link: { calendar_source_id: string; google_event_id: string } | null;
  sourceId: string;
  googleEventId: string;
  remoteState: "live" | "cancelled" | "missing" | "unknown";
}): CancellationAction {
  const { link, sourceId, googleEventId, remoteState } = input;
  if (!link) return "ignore";
  if (link.google_event_id !== googleEventId) return "ignore";
  if (link.calendar_source_id !== sourceId) return "ignore";
  if (remoteState === "live") return "ignore";
  if (remoteState === "unknown") return "ignore";
  return "remove";
}

/* ------------------------------------------- detached recurring exceptions */

/**
 * Stable identity of one occurrence of a Google recurring series.
 *
 * Google's instance id can change (a tombstone, a re-detach, a moved copy), but
 * the occurrence's *original* start never does, so that is what the app stores
 * and reconciles on.
 */
export function originalStartKey(
  value: { date?: string | null; dateTime?: string | null } | null | undefined,
): string | null {
  const raw = value?.dateTime ?? value?.date ?? null;
  if (!raw) return null;
  if (raw.length <= 10) return raw;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? raw : new Date(ms).toISOString();
}

/** True when the same occurrence is meant, tolerating date vs date-time form. */
export function sameOriginalStart(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.slice(0, 10) === b.slice(0, 10) && (a.length <= 10 || b.length <= 10);
}

/** A link row that represents a detached exception rather than a whole series. */
export function isExceptionLink(link: {
  google_recurring_event_id?: string | null;
  google_original_start?: string | null;
}): boolean {
  return Boolean(link.google_recurring_event_id && link.google_original_start);
}

/**
 * Series links whose branch key no longer exists in the desired representation.
 *
 * Used when an event flips between a shared series ([""]) and per-person
 * branches (["MO","WE"]): the obsolete Google series must go even though it is
 * still alive in Google. Detached exception links are never obsolete here —
 * they are anchored by occurrence identity, not by branch key.
 */
export function obsoleteBranchLinks<
  T extends {
    branch_key: string;
    google_recurring_event_id?: string | null;
    google_original_start?: string | null;
  },
>(desiredKeys: Iterable<string>, links: T[]): T[] {
  const desired = new Set(desiredKeys);
  return links.filter((link) => !isExceptionLink(link) && !desired.has(link.branch_key));
}

/**
 * Desired branch keys that have no parent (non-exception) link yet.
 *
 * A push whose Google write succeeded but whose link upsert never landed leaves
 * exactly this shape: one healthy branch link and one missing sibling. Inbound
 * sync would then import the unlinked Google series as a standalone event, so
 * reconciliation must repair it even though another valid link exists.
 */
export function missingBranchKeys<
  T extends {
    branch_key: string;
    google_recurring_event_id?: string | null;
    google_original_start?: string | null;
  },
>(desiredKeys: Iterable<string>, links: T[]): string[] {
  const present = new Set(
    links.filter((link) => !isExceptionLink(link)).map((link) => link.branch_key),
  );
  return [...new Set(desiredKeys)].filter((key) => !present.has(key));
}

/**
 * Whether a cancellation tombstone may remove a *detached* exception.
 *
 * Google often reports the original recurring occurrence as cancelled — that is
 * exactly what detaching means — and can re-key the detached instance. So the
 * local exception is only removed once Google confirms the detached occurrence
 * itself is gone; anything else keeps it (and its parent exclusion) intact.
 */
export function exceptionCancellationAction(input: {
  occurrenceState: "live" | "gone" | "unknown";
}): CancellationAction {
  return input.occurrenceState === "gone" ? "remove" : "ignore";
}

/* ------------------------------------------------- sync-target availability */

export type GoogleFailureKind = "auth" | "calendar_unavailable" | "transient";

const AUTH_HINTS = [
  "invalid_grant",
  "invalid_token",
  "authError",
  "unauthorized",
  "insufficientPermissions",
  "insufficient_scope",
  "connection_not_found",
  "credentials",
];

/**
 * Classifies a failed Google/gateway response.
 *
 * The distinction matters a lot: a revoked grant needs the owner to reconnect
 * Google, a deleted/unshared calendar needs a new sync target, and anything
 * else is transient and must be retried instead of pausing sync.
 */
export function classifyGoogleFailure(status: number, body = ""): GoogleFailureKind {
  const hasAuthHint = AUTH_HINTS.some((hint) =>
    body.toLowerCase().includes(hint.toLowerCase()),
  );
  if (status === 401) return "auth";
  if (status === 404 || status === 410) return "calendar_unavailable";
  if (status === 403) {
    if (body.includes("notFound") || body.includes("requiredAccessLevel")) {
      return "calendar_unavailable";
    }
    return hasAuthHint ? "auth" : "calendar_unavailable";
  }
  if (hasAuthHint && status >= 400 && status < 500) return "auth";
  return "transient";
}

/** New local name when Google's calendar was renamed, otherwise null. */
export function calendarNameChange(localName: string, remoteSummary?: string | null): string | null {
  const remote = (remoteSummary ?? "").trim();
  if (!remote) return null;
  return remote === localName.trim() ? null : remote;
}

export interface SourceSyncPatch {
  sync_status?: "active" | "needs_attention";
  sync_error?: string | null;
  sync_failure_count?: number;
  sync_paused_at?: string | null;
}

/**
 * The `calendar_sources` patch for a sync outcome.
 *
 * Deliberately never touches `external_calendar_id`, event links or any local
 * event: losing the sync target pauses syncing, it never mutates family data.
 */
export function sourceSyncPatch(input: {
  outcome: "ok" | "unavailable" | "transient";
  reason?: string | null;
  failureCount: number;
  now: string;
}): SourceSyncPatch {
  if (input.outcome === "ok") {
    return { sync_status: "active", sync_error: null, sync_failure_count: 0, sync_paused_at: null };
  }
  if (input.outcome === "unavailable") {
    return {
      sync_status: "needs_attention",
      sync_error: (input.reason ?? "Calendar unavailable").slice(0, 500),
      sync_failure_count: input.failureCount + 1,
      sync_paused_at: input.now,
    };
  }
  return {
    sync_error: (input.reason ?? "Temporary sync failure").slice(0, 500),
    sync_failure_count: input.failureCount + 1,
  };
}

/**
 * True when the live Google master of a recurring timed event no longer matches
 * what current mapping would generate. Some series written before the DST fix
 * still carry fixed-offset dateTimes or a non-IANA timezone even though their
 * link is marked current, so the remote body itself has to be inspected.
 *
 * Times are compared semantically, never as strings: Google may echo an
 * RFC3339 offset (`2026-10-26T16:00:00-07:00`) for a body written as a floating
 * wall clock (`2026-10-26T16:00:00`). Those mean the same intended local time,
 * so the remote value is parsed as an instant and converted into the expected
 * IANA zone before comparing. The expected timezone and the recurrence lines
 * must still match exactly, so real drift stays stale.
 */
export function remoteRecurringBodyIsStale(
  expected: { start?: GoogleDateTime; end?: GoogleDateTime; recurrence?: string[] | null },
  remote: { start?: GoogleDateTime; end?: GoogleDateTime; recurrence?: string[] | null },
): boolean {
  const hasOffset = (dt: string) => /(z|[+-]\d{2}:?\d{2})$/i.test(dt);

  const timesDiffer = (a?: GoogleDateTime, b?: GoogleDateTime) => {
    const zone = a?.timeZone ?? null;
    if (zone !== (b?.timeZone ?? null)) return true;
    const want = (a?.dateTime ?? "").trim();
    const got = (b?.dateTime ?? "").trim();
    if (!want || !got) return want !== got;
    if (want === got) return false;
    // Only an offset-bearing remote value can be semantically equivalent to an
    // offsetless expected wall clock, and only with a known IANA zone.
    if (hasOffset(want) || !hasOffset(got) || !zone || !isIanaTimeZone(zone)) return true;
    const instant = new Date(got);
    if (Number.isNaN(instant.getTime())) return true;
    return localWallClock(instant.toISOString(), zone).slice(0, 16) !== want.slice(0, 16);
  };

  if (timesDiffer(expected.start, remote.start)) return true;
  if (timesDiffer(expected.end, remote.end)) return true;
  const norm = (lines?: string[] | null) =>
    [...(lines ?? [])].map((l) => l.trim().toUpperCase()).sort().join("\n");
  return norm(expected.recurrence) !== norm(remote.recurrence);
}

/**
 * True when a live master's own times cannot prove DST health: an offset-bearing
 * (or UTC) dateTime, or a missing / non-IANA timeZone. Those bodies expand with
 * fixed-offset semantics even when the strings happen to look right, so the
 * caller falls back to inspecting one expanded occurrence.
 */
export function remoteRecurringTimesAreAmbiguous(remote: {
  start?: GoogleDateTime;
  end?: GoogleDateTime;
}): boolean {
  const fixedOffset = (v?: GoogleDateTime) => {
    const dt = (v?.dateTime ?? "").trim();
    if (!dt) return false;
    return /(z|[+-]\d{2}:?\d{2})$/i.test(dt);
  };
  const badZone = (v?: GoogleDateTime) => !isIanaTimeZone(v?.timeZone ?? null);
  return (
    fixedOffset(remote.start) ||
    fixedOffset(remote.end) ||
    badZone(remote.start) ||
    badZone(remote.end)
  );
}


/**
 * True when an expanded occurrence no longer lands on the intended household
 * wall-clock time (the visible symptom of fixed-offset expansion across DST).
 *
 * Health is judged in the household/event zone, not from the offset Google
 * happens to render with: Google returns expanded instances in the target
 * calendar's own timezone, so a Los Angeles series on a Phoenix calendar comes
 * back as `2026-11-02T17:00:00-07:00` — the same instant as 16:00 -08:00, and
 * therefore the intended 4 PM Los Angeles time. The offset-bearing string is
 * parsed as an instant and converted into the expected zone before comparing.
 */
export function occurrenceWallClockDrifted(
  expectedWallClock: string | null | undefined,
  occurrence: GoogleDateTime | undefined,
  timeZone: string,
): boolean {
  const expected = (expectedWallClock ?? "").slice(11, 16);
  const raw = (occurrence?.dateTime ?? "").trim();
  if (!expected || !raw) return false;

  const hasOffset = /(z|[+-]\d{2}:?\d{2})$/i.test(raw);
  if (!hasOffset) {
    // floating wall clock: the string itself is already the local time
    const literal = raw.slice(11, 16);
    return literal ? literal !== expected : false;
  }

  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) return false;
  const local = localWallClock(instant.toISOString(), timeZone).slice(11, 16);
  return local !== expected;
}

