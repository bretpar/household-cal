/**
 * Smart Coverage engine — deterministic, UI-free, no AI. Finds times when both
 * parents' designated work calendars overlap and compares them with Babysitter
 * calendar shifts and the private monthly draft. Results are scheduling
 * suggestions only; they never assume a caregiver is available.
 */
import type { CalendarEvent } from "@/lib/family-data";
import { existingMonthShifts, monthDates, sameIdentity, type ExistingShift, type Lineage, type ProposedShift, type ScheduleDraft } from "@/lib/schedule-builder";

export type SourceHealth = "ok" | "missing" | "unavailable" | "stale" | "incomplete";
/** Dates (YYYY-MM-DD, inclusive) the source's imported events are verified to cover; null = no verified range. */
export interface ImportRange { from: string; to: string }
export interface ParentCalendar { label: string; sourceId: string | null; sourceName: string | null; health: SourceHealth; range?: ImportRange | null }
export interface CoverageSettings { parents: [ParentCalendar, ParentCalendar]; bufferBefore: number; bufferAfter: number }
export type Interval = [number, number]; // minutes from household midnight, [start, end)
export type DayStatus = "not-needed" | "covered" | "partial" | "missing" | "no-care" | "review";
export interface Suggestion { key: string; date: string; start: string; end: string }
export interface DayCoverage {
  date: string; status: DayStatus;
  needed: Interval[]; uncovered: Interval[]; unassignedOnly: Interval[];
  suggestions: Suggestion[]; ignoredAllDay: boolean;
}
export interface CoverageResult { complete: boolean; problems: string[]; days: DayCoverage[] }

const MIN_DAY = 0, MAX_DAY = 24 * 60;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const toTime = (m: number) => m >= MAX_DAY ? "23:59" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const [a, b] of sorted) { const last = out.at(-1); if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]); }
  return out;
}
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [s1, e1] of a) for (const [s2, e2] of b) { const s = Math.max(s1, s2), e = Math.min(e1, e2); if (e > s) out.push([s, e]); }
  return mergeIntervals(out);
}
export function subtract(a: Interval[], b: Interval[]): Interval[] {
  let rest = mergeIntervals(a);
  for (const [bs, be] of mergeIntervals(b)) rest = rest.flatMap(([s, e]): Interval[] => be <= s || bs >= e ? [[s, e]] : [...(bs > s ? [[s, bs] as Interval] : []), ...(be < e ? [[be, e] as Interval] : [])]);
  return rest;
}

type Span = { date: string; endDate: string; start: string; end: string; allDay: boolean };
/** Clip a (possibly multi-day) timed span to one household date. All-day spans are excluded. */
function onDate(s: Span, date: string): Interval | null {
  if (s.allDay || s.date > date || s.endDate < date) return null;
  const a = s.date === date ? toMin(s.start) : MIN_DAY;
  const b = s.endDate === date ? (s.end === "23:59" && s.date !== s.endDate ? MAX_DAY : toMin(s.end)) : MAX_DAY;
  return b > a ? [a, b] : null;
}

export interface CoverageInput {
  month: string; timeZone: string; settings: CoverageSettings;
  workEvents: [CalendarEvent[], CalendarEvent[]];
  existing: ExistingShift[]; draft: ScheduleDraft; lineage: Lineage;
}

export function computeCoverage(input: CoverageInput): CoverageResult {
  const { month, timeZone, settings, draft, existing } = input;
  const problems: string[] = [];
  settings.parents.forEach(p => {
    if (p.health === "missing") problems.push(`${p.label}'s work calendar isn't chosen.`);
    else if (p.health === "unavailable") problems.push(`${p.label}'s work calendar (${p.sourceName ?? "removed"}) is unavailable.`);
    else if (p.health === "stale") problems.push(`${p.label}'s work calendar (${p.sourceName}) hasn't synced recently.`);
    else if (p.health === "incomplete") problems.push(`${p.label}'s work calendar (${p.sourceName}) has a sync problem and may be incomplete.`);
    if (p.health === "ok" && !monthInRange(month, p.range)) problems.push(`${p.label}'s work calendar (${p.sourceName}) hasn't imported events for this month, so coverage can't be confirmed.`);
  });
  const work = input.workEvents.map(events => existingMonthShifts(events, month, timeZone, input.lineage));
  const decisions = draft.coverage ?? { ignored: [], noCare: [] };
  // Effective shifts: draft proposals replace the existing occurrence they reference.
  const kept = existing.filter(e => !draft.shifts.some(s => sameIdentity(s, e)));
  const shifts: (Span & { assigned: boolean })[] = [
    ...kept.map(e => ({ ...e, assigned: e.assignment.kind !== "none" })),
    ...draft.shifts.map((s: ProposedShift) => ({ date: s.date, endDate: s.date, start: s.start, end: s.end, allDay: false, assigned: s.assignment.kind !== "none" })),
  ];
  const days = monthDates(month).map((date): DayCoverage => {
    const busy = work.map(list => mergeIntervals(list.flatMap(s => { const i = onDate(s, date); return i ? [i] : []; })));
    const ignoredAllDay = work.some(list => list.some(s => s.allDay && s.date <= date && s.endDate >= date));
    const overlap = intersect(busy[0] ?? [], busy[1] ?? []);
    const needed = mergeIntervals(overlap.map(([a, b]) => [Math.max(MIN_DAY, a - settings.bufferBefore), Math.min(MAX_DAY, b + settings.bufferAfter)] as Interval));
    const confirmed = shifts.filter(s => s.assigned).flatMap(s => { const i = onDate(s, date); return i ? [i] : []; });
    const tentative = shifts.filter(s => !s.assigned).flatMap(s => { const i = onDate(s, date); return i ? [i] : []; });
    const uncovered = subtract(needed, confirmed);
    const unassignedOnly = intersect(uncovered, mergeIntervals(tentative));
    const gaps = subtract(uncovered, tentative); // never suggest on top of an existing Unassigned shift
    const noCare = decisions.noCare.includes(date);
    // An excluded all-day work event means the day can't be confirmed covered or not needed.
    const status: DayStatus = noCare && (needed.length || ignoredAllDay) ? "no-care"
      : ignoredAllDay && (!needed.length || !uncovered.length) ? "review"
      : !needed.length ? "not-needed" : !uncovered.length ? "covered"
      : uncovered.reduce((n, [a, b]) => n + b - a, 0) < needed.reduce((n, [a, b]) => n + b - a, 0) ? "partial" : "missing";
    const suggestions = noCare ? [] : gaps.map(([a, b]) => {
      const start = toTime(Math.floor(a / 15) * 15), end = toTime(Math.min(MAX_DAY, Math.ceil(b / 15) * 15));
      return { key: `${date}|${start}|${end}`, date, start, end };
    }).filter(s => s.start < s.end && !decisions.ignored.includes(s.key));
    return { date, status, needed, uncovered, unassignedOnly, suggestions, ignoredAllDay };
  });
  const review = days.filter(d => d.ignoredAllDay).length;
  if (review) problems.push(`${review} ${review === 1 ? "day has" : "days have"} all-day work events that aren't counted — review ${review === 1 ? "it" : "them"} manually.`);
  return { complete: problems.length === 0, problems, days };
}

/** Add a suggestion to the private draft through the normal reconciliation rules. */
export function suggestionToShift(s: Suggestion, assignment: ProposedShift["assignment"], id: string): ProposedShift {
  return { id, date: s.date, start: s.start, end: s.end, title: "Babysitter", assignment };
}
export function ignoreSuggestion(draft: ScheduleDraft, key: string): ScheduleDraft {
  const c = draft.coverage ?? { ignored: [], noCare: [] };
  return { ...draft, coverage: { ...c, ignored: [...new Set([...c.ignored, key])] } };
}
export function setNoCare(draft: ScheduleDraft, date: string, on: boolean): ScheduleDraft {
  const c = draft.coverage ?? { ignored: [], noCare: [] };
  return { ...draft, coverage: { ...c, noCare: on ? [...new Set([...c.noCare, date])] : c.noCare.filter(d => d !== date) } };
}

/** True only when the whole month lies inside the verified import range. */
export function monthInRange(month: string, range: ImportRange | null | undefined): boolean {
  if (range === undefined) return true; // range not tracked for this source (local calendars)
  if (!range) return false;
  const dates = monthDates(month);
  return range.from <= dates[0]! && range.to >= dates.at(-1)!;
}

/**
 * Narrowest window an external source's import is guaranteed to cover, anchored
 * at its last successful sync (Google ongoing: −1/+3 months; Apple/ICS: −30 days/+12 months).
 * Local calendars return undefined (no import); unknown providers or never-synced return null.
 */
export function importRange(row: { provider: string; last_synced_at: string | null } | undefined): ImportRange | null | undefined {
  if (!row) return null;
  if (row.provider === "local") return undefined;
  if (!row.last_synced_at) return null;
  const at = new Date(row.last_synced_at); if (Number.isNaN(at.getTime())) return null;
  const from = new Date(at), to = new Date(at);
  if (row.provider === "google") { from.setUTCMonth(from.getUTCMonth() - 1); to.setUTCMonth(to.getUTCMonth() + 3); }
  else if (row.provider === "ics") { from.setUTCDate(from.getUTCDate() - 30); to.setUTCMonth(to.getUTCMonth() + 12); }
  else return null;
  // Shrink by a day on each side so household-timezone offsets never overstate coverage.
  from.setUTCDate(from.getUTCDate() + 1); to.setUTCDate(to.getUTCDate() - 1);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/** Classify a calendar source for coverage. Never treats missing data as availability. */
export function sourceHealth(row: { active: boolean; provider: string; sync_error: string | null; sync_paused_at: string | null; sync_status: string; last_synced_at: string | null } | undefined, now = Date.now()): SourceHealth {
  if (!row || !row.active) return "unavailable";
  if (row.provider === "local") return "ok";
  if (row.sync_error || row.sync_paused_at || row.sync_status === "needs_attention") return "incomplete";
  if (!row.last_synced_at || now - Date.parse(row.last_synced_at) > 24 * 3600_000) return "stale";
  return "ok";
}
