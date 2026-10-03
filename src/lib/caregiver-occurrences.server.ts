/**
 * Trusted, server-only expansion of recurring events for caregivers limited to
 * their own shift days. Row-level security hides every recurring master from
 * these caregivers; this module reads them with elevated access and returns
 * only sanitized single occurrences on dates unlocked by the caller's own
 * assigned shifts. Identity comes solely from the verified session user id.
 * Any failure throws — callers must never fall back to raw masters.
 */
import type { CalendarEvent, CalendarSource, DisplayMode, MemberColor } from "@/lib/family-data";
import { seriesOccursOnKey } from "@/lib/family-data";
import { localDateKey } from "@/lib/google/occurrence";

type Db = { from: (table: string) => any };

const DAY = 86_400_000;
const CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

function addDays(key: string, n: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

function wallParts(iso: string, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(iso));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: g("year"), m: g("month"), d: g("day"), h: g("hour") % 24, mi: g("minute"), s: g("second") };
}

/** UTC instant for a wall-clock time on `dateKey` in `tz`. */
function zonedInstant(dateKey: string, h: number, mi: number, s: number, tz: string): number {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const target = Date.UTC(y, m - 1, d, h, mi, s);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = wallParts(new Date(guess).toISOString(), tz);
    const seen = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
    guess += target - seen;
  }
  return guess;
}

interface Master {
  id: string; start_at: string; end_at: string; all_day: boolean;
  recurrence_rule: string | null; recurrence_until: string | null; excluded_dates: string[] | null;
}

function startKey(e: Master, tz: string): string | null {
  return e.all_day ? e.start_at.slice(0, 10) : localDateKey(e.start_at, tz);
}

function covers(e: Master, key: string, tz: string): boolean {
  // Same recurrence engine the Owner calendar uses (BYDAY ordinals, COUNT,
  // UNTIL, excluded dates written when one occurrence is moved or deleted).
  const first = startKey(e, tz);
  return !!first && seriesOccursOnKey(e, first, key);
}

/** Occurrence dates of a series from its start through `lastKey`, honouring COUNT. */
function seriesDates(e: Master, tz: string, fromKey: string, lastKey: string): string[] {
  const first = startKey(e, tz);
  if (!first) return [];
  const out: string[] = [];
  for (let k = first > fromKey ? first : fromKey; k <= lastKey; k = addDays(k, 1)) {
    if (covers(e, k, tz)) out.push(k);
  }
  return out;
}

/** Local dates an occurrence actually spans: start date through inclusive end date. */
function spanKeys(dateKey: string, e: Master, tz: string): string[] {
  const dur = new Date(e.end_at).getTime() - new Date(e.start_at).getTime();
  if (e.all_day) return [dateKey];
  const w = wallParts(e.start_at, tz);
  const start = zonedInstant(dateKey, w.h, w.mi, w.s, tz);
  const endKey = localDateKey(new Date(start + Math.max(dur - 1, 0)).toISOString(), tz) ?? dateKey;
  const keys = [dateKey];
  for (let k = addDays(dateKey, 1); k <= endKey; k = addDays(k, 1)) keys.push(k);
  return keys;
}

/** Optional read-only decision trace for one date (owner diagnostic only). */
export interface VisibilityTrace {
  date: string;
  authorized: boolean;
  shiftEventIds: string[];
  decisions: Record<string, string>;
}

export async function loadSecureCaregiverOccurrences(
  userId: string,
  familyId: string,
  sources: CalendarSource[],
  trace?: VisibilityTrace,
): Promise<CalendarEvent[]> {
  const note = (id: string, why: string) => { if (trace && !trace.decisions[id]) trace.decisions[id] = why; };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as Db;

  const fuRes = await admin
    .from("family_users").select("id, role, family_member_id").eq("family_id", familyId).eq("user_id", userId).maybeSingle();
  if (fuRes.error) throw fuRes.error;
  if (!fuRes.data || fuRes.data.role !== "viewer") throw new Error("Not authorised");
  const fuId = fuRes.data.id as string;

  const [profRes, calsRes, famRes] = await Promise.all([
    admin.from("babysitter_access_profiles").select("date_scope").eq("family_user_id", fuId).maybeSingle(),
    admin.from("babysitter_access_calendars").select("calendar_source_id").eq("family_user_id", fuId),
    admin.from("families").select("timezone").eq("id", familyId).maybeSingle(),
  ]);
  for (const r of [profRes, calsRes, famRes]) if (r.error) throw r.error;
  if (profRes.data?.date_scope !== "shift_days_only") throw new Error("Not authorised");
  const tz = (famRes.data?.timezone as string) || "UTC";
  const permitted = new Set<string>((calsRes.data ?? []).map((c: any) => c.calendar_source_id as string));
  if (permitted.size === 0) return [];

  // Dates unlocked by shifts explicitly assigned to this caregiver.
  const shiftsRes = await admin
    .from("babysitter_shifts")
    .select("event_id, events!inner(id, family_id, start_at, end_at, all_day, recurrence_rule, recurrence_until, excluded_dates)")
    .eq("family_id", familyId).eq("assignment", "caregiver")
    .or(fuRes.data.family_member_id ? `family_user_id.eq.${fuId},assignee_member_id.eq.${fuRes.data.family_member_id}` : `family_user_id.eq.${fuId}`);
  if (shiftsRes.error) throw shiftsRes.error;
  const today = new Date().toISOString().slice(0, 10);
  const fromKey = addDays(today, -180);
  const lastKey = addDays(today, 400);
  const authorized = new Set<string>();
  const ownIds = new Set<string>();
  for (const row of shiftsRes.data ?? []) {
    const e = row.events as Master & { family_id: string };
    if (!e || e.family_id !== familyId) continue;
    ownIds.add(e.id);
    const dates = e.recurrence_rule
      ? seriesDates(e, tz, fromKey, lastKey)
      : [startKey(e, tz)].filter((k): k is string => !!k);
    for (const d of dates) for (const k of spanKeys(d, e, tz)) authorized.add(k);
  }
  if (trace) { trace.authorized = authorized.has(trace.date); trace.shiftEventIds = [...ownIds]; }
  if (authorized.size === 0) return [];

  const evRes = await admin
    .from("events")
    .select("id, family_id, calendar_source_id, title, start_at, end_at, all_day, location, notes, event_type, category_id, recurrence_rule, recurrence_until, excluded_dates, created_at, event_members(family_member_id, weekdays)")
    .eq("family_id", familyId)
    .not("recurrence_rule", "is", null)
    .in("calendar_source_id", [...permitted]);
  if (evRes.error) throw evRes.error;

  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const keys = [...authorized].sort();
  const out: CalendarEvent[] = [];
  for (const e of evRes.data ?? []) {
    const own = ownIds.has(e.id);
    const source = sourceById.get(e.calendar_source_id);
    if (!source) { note(e.id, "EXCLUDED: calendar source missing"); continue; }
    const styled = source.provider === "google" || source.provider === "ics" ||
      (source.provider === "local" && source.calendar_kind === "custom");
    const dur = new Date(e.end_at).getTime() - new Date(e.start_at).getTime();
    const w = e.all_day ? null : wallParts(e.start_at, tz);
    const occurrenceDates = new Set(seriesDates(e, tz, keys[0]!, keys[keys.length - 1]!));
    if (trace) {
      if (!authorized.has(trace.date)) note(e.id, "EXCLUDED: date not authorized");
      else if ((e.excluded_dates ?? []).includes(trace.date)) note(e.id, "EXCLUDED: master occurrence replaced/deleted by exception");
      else if (!occurrenceDates.has(trace.date)) note(e.id, "EXCLUDED: series has no effective occurrence on selected date");
    }
    for (const k of keys) {
      if (!occurrenceDates.has(k)) continue;
      const code = CODES[new Date(`${k}T00:00:00Z`).getUTCDay()]!;
      const links = (e.event_members ?? []) as { family_member_id: string; weekdays: string[] | null }[];
      const hasRules = links.some((l) => l.weekdays && l.weekdays.length > 0);
      const members = links.filter((l) => !l.weekdays || l.weekdays.length === 0 || l.weekdays.includes(code));
      if (hasRules && members.length === 0) {
        if (trace && k === trace.date) note(e.id, "EXCLUDED: per-weekday participant rules leave no one on this weekday");
        continue;
      }
      if (trace && k === trace.date) note(e.id, "INCLUDED (effective recurring occurrence)");
      const startMs = w ? zonedInstant(k, w.h, w.mi, w.s, tz) : Date.parse(`${k}T00:00:00Z`);
      const endIso = e.all_day ? `${k}T23:59:59Z` : new Date(startMs + dur).toISOString();
      out.push({
        id: `${e.id}::${k}`,
        family_id: familyId,
        calendar_source_id: e.calendar_source_id,
        display_mode: source.display_mode as DisplayMode,
        read_only: true,
        source_color: styled ? ((source.color ?? null) as MemberColor | null) : null,
        source_icon: styled ? (source.display_icon ?? null) : null,
        source_name: styled ? source.name : null,
        title: e.title,
        start_at: new Date(startMs).toISOString(),
        end_at: endIso,
        all_day: e.all_day,
        location: e.location,
        notes: e.notes,
        event_type: e.event_type,
        category_id: e.category_id ?? null,
        recurrence_rule: null,
        recurrence_until: null,
        excluded_dates: [],
        needs_family_assignment: false,
        created_at: null,
        external_event_id: null,
        external_recurring_event_id: null,
        participants: members.map((m) => ({ member_id: m.family_member_id, weekdays: null })),
        member_ids: members.map((m) => m.family_member_id),
        shift_assignment: own ? { kind: "caregiver", family_member_id: (fuRes.data.family_member_id as string | null) ?? "" } : null,
        ...(own ? { is_my_shift: true } : {}),
      } as CalendarEvent);
    }
  }

  // One-off events on dates unlocked only by repeating shifts. RLS unlocks
  // one-off shift dates itself; duplicates are removed by the caller.
  const oneRes = await admin
    .from("events")
    .select("id, calendar_source_id, title, start_at, end_at, all_day, location, notes, event_type, category_id, external_recurring_event_id, event_members(family_member_id)")
    .eq("family_id", familyId)
    .is("recurrence_rule", null)
    .in("calendar_source_id", [...permitted])
    .gte("end_at", `${keys[0]!}T00:00:00Z`)
    .lte("start_at", `${addDays(keys[keys.length - 1]!, 1)}T23:59:59Z`);
  if (oneRes.error) throw oneRes.error;
  for (const e of oneRes.data ?? []) {
    const source = sourceById.get(e.calendar_source_id);
    if (!source) { note(e.id, "EXCLUDED: calendar source missing"); continue; }
    const m = { ...e, recurrence_rule: null, recurrence_until: null, excluded_dates: null } as Master;
    const first = startKey(m, tz);
    if (!first) continue;
    const span = e.all_day
      ? (() => { const ks: string[] = []; const last = addDays(e.end_at.slice(0, 10), 0); for (let k = first; k <= last; k = addDays(k, 1)) ks.push(k); return ks; })()
      : spanKeys(first, m, tz);
    if (trace) {
      if (!span.includes(trace.date)) note(e.id, "EXCLUDED: one-off span does not overlap date");
      else if (!authorized.has(trace.date)) note(e.id, "EXCLUDED: date not authorized");
    }
    if (!span.some((k) => authorized.has(k))) continue;
    if (trace && span.includes(trace.date)) note(e.id, e.external_recurring_event_id ? "INCLUDED (detached/edited occurrence on shift day)" : "INCLUDED (secure one-off on shift day)");
    const styled = source.provider === "google" || source.provider === "ics" ||
      (source.provider === "local" && source.calendar_kind === "custom");
    const ids = ((e.event_members ?? []) as { family_member_id: string }[]).map((l) => l.family_member_id);
    out.push({
      id: e.id, family_id: familyId, calendar_source_id: e.calendar_source_id,
      display_mode: source.display_mode as DisplayMode, read_only: true,
      source_color: styled ? ((source.color ?? null) as MemberColor | null) : null,
      source_icon: styled ? (source.display_icon ?? null) : null,
      source_name: styled ? source.name : null,
      title: e.title, start_at: e.start_at, end_at: e.end_at, all_day: e.all_day,
      location: e.location, notes: e.notes, event_type: e.event_type, category_id: e.category_id ?? null,
      recurrence_rule: null, recurrence_until: null, excluded_dates: [], needs_family_assignment: false,
      created_at: null, external_event_id: null, external_recurring_event_id: null,
      participants: ids.map((id) => ({ member_id: id, weekdays: null })), member_ids: ids,
      shift_assignment: null, shift_gate: true,
    } as CalendarEvent);
  }
  return out;
}
