/**
 * Developer-only inbound-sync diagnostics for Google Calendar.
 *
 * Read-only by design: `diagnoseGoogleDay` never writes anything, it just
 * reports what Google returns for one calendar/day and what the app's existing
 * link bookkeeping says about each item. The single-event repair path reuses the
 * normal `applyGoogleEvent` pipeline so behaviour cannot drift from live sync.
 *
 * Server-only.
 */
import * as google from "@/lib/google/api.server";
import type { GoogleEvent } from "@/lib/google/mapping";
import {
  applyGoogleEvent,
  getConnection,
  initialsFor,
  type ConnectionContext,
  type SourceRow,
} from "@/lib/google/sync.server";
import { normalizeTimeZone } from "@/lib/google/timezone";

type Admin = { from: (table: string) => any };

const SOURCE_COLUMNS =
  "id, family_id, name, external_calendar_id, is_main, google_sync_token, google_channel_id, google_channel_resource_id, sync_status, sync_failure_count, app_managed_calendar";

/** Offset-correct UTC bounds for one calendar day in the household timezone. */
function dayBounds(date: string, timeZone: string): { timeMin: string; timeMax: string } {
  const offsetAt = (utc: Date): number => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(utc);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    const asUTC = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour") % 24,
      get("minute"),
      get("second"),
    );
    return asUTC - utc.getTime();
  };
  const naive = Date.parse(`${date}T00:00:00Z`);
  const guess = new Date(naive - offsetAt(new Date(naive)));
  const start = new Date(naive - offsetAt(guess));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

export interface DiagnosticLink {
  id: string;
  event_id: string;
  calendar_source_id: string;
  google_event_id: string;
  google_recurring_event_id: string | null;
  branch_key: string;
  last_source: string;
  google_updated_at: string | null;
  sync_error: string | null;
}

export interface DiagnosticItem {
  title: string | null;
  google_event_id: string;
  recurring_event_id: string | null;
  original_start_time: string | null;
  status: string | null;
  start: string | null;
  end: string | null;
  all_day: boolean;
  recurrence: string[] | null;
  updated: string | null;
  /** What normal inbound sync would do with this item right now. */
  decision:
    | "linked"
    | "would_create"
    | "would_create_exception"
    | "would_exclude_occurrence"
    | "would_delete"
    | "no_link"
    | "skipped_no_series";
  decision_detail: string;
  local_event_id: string | null;
  local_event_title: string | null;
  link: DiagnosticLink | null;
}

export interface DiagnosticReport {
  calendar: { id: string; name: string; external_calendar_id: string; sync_status: string };
  date: string;
  time_zone: string;
  range: { timeMin: string; timeMax: string };
  items: DiagnosticItem[];
  skipped?: string;
}

async function sourceById(
  admin: Admin,
  familyId: string,
  sourceId: string,
): Promise<SourceRow | null> {
  const { data } = await admin
    .from("calendar_sources")
    .select(SOURCE_COLUMNS)
    .eq("family_id", familyId)
    .eq("id", sourceId)
    .maybeSingle();
  return (data as SourceRow | null) ?? null;
}

function timesOf(g: GoogleEvent): { start: string | null; end: string | null; allDay: boolean } {
  const allDay = Boolean(g.start?.date);
  return {
    start: g.start?.dateTime ?? g.start?.date ?? null,
    end: g.end?.dateTime ?? g.end?.date ?? null,
    allDay,
  };
}

/** Read-only: reports Google's view of one day and the app's link state for it. */
export async function diagnoseGoogleDay(
  admin: Admin,
  familyId: string,
  sourceId: string,
  date: string,
): Promise<DiagnosticReport | { skipped: string }> {
  const conn = await getConnection(admin, familyId);
  if (!conn) return { skipped: "not_connected" };
  const source = await sourceById(admin, familyId, sourceId);
  if (!source || !source.external_calendar_id) return { skipped: "no_google_calendar" };

  const { data: familyRow } = await admin
    .from("families")
    .select("timezone")
    .eq("id", familyId)
    .maybeSingle();
  const timeZone = normalizeTimeZone(familyRow?.timezone as string | null);
  const range = dayBounds(date, timeZone);

  const items = await google.listEventsInRange(
    conn.connectionKey,
    source.external_calendar_id,
    range.timeMin,
    range.timeMax,
  );

  const report: DiagnosticItem[] = [];
  for (const g of items) {
    const { data: linkRow } = await admin
      .from("event_sync_links")
      .select(
        "id, event_id, calendar_source_id, google_event_id, google_recurring_event_id, branch_key, last_source, google_updated_at, sync_error",
      )
      .eq("family_id", familyId)
      .eq("google_event_id", g.id)
      .maybeSingle();
    const link = (linkRow as DiagnosticLink | null) ?? null;

    let seriesLink: DiagnosticLink | null = null;
    if (!link && g.recurringEventId) {
      const { data: rows } = await admin
        .from("event_sync_links")
        .select(
          "id, event_id, calendar_source_id, google_event_id, google_recurring_event_id, branch_key, last_source, google_updated_at, sync_error",
        )
        .eq("family_id", familyId)
        .eq("google_event_id", g.recurringEventId);
      const candidates = (rows ?? []) as DiagnosticLink[];
      seriesLink =
        candidates.find((l) => l.calendar_source_id === source.id) ?? candidates[0] ?? null;
    }

    let decision: DiagnosticItem["decision"];
    let detail: string;
    if (g.status === "cancelled") {
      if (link) {
        decision = "would_delete";
        detail = "linked event; cancellation verified against Google before delete";
      } else if (seriesLink) {
        decision = "would_exclude_occurrence";
        detail = "cancelled occurrence of a linked series";
      } else {
        decision = "no_link";
        detail = "cancelled and unknown to the app; nothing to do";
      }
    } else if (link) {
      decision = "linked";
      detail = `linked (last_source=${link.last_source}, branch="${link.branch_key}")`;
    } else if (g.recurringEventId && seriesLink) {
      decision = "would_create_exception";
      detail = "instance of a linked series; would detach as an occurrence exception";
    } else if (g.recurringEventId) {
      decision = "skipped_no_series";
      detail = `no link for recurring master ${g.recurringEventId}; would import as a new standalone event`;
    } else {
      decision = "would_create";
      detail = "no link found; would import as a new event";
    }

    const localId = link?.event_id ?? seriesLink?.event_id ?? null;
    let localTitle: string | null = null;
    if (localId) {
      const { data: ev } = await admin
        .from("events")
        .select("title")
        .eq("id", localId)
        .maybeSingle();
      localTitle = (ev?.title as string | null) ?? null;
    }

    const times = timesOf(g);
    report.push({
      title: g.summary ?? null,
      google_event_id: g.id,
      recurring_event_id: g.recurringEventId ?? null,
      original_start_time:
        g.originalStartTime?.dateTime ?? g.originalStartTime?.date ?? null,
      status: g.status ?? null,
      start: times.start,
      end: times.end,
      all_day: times.allDay,
      recurrence: g.recurrence ?? null,
      updated: g.updated ?? null,
      decision,
      decision_detail: detail,
      local_event_id: localId,
      local_event_title: localTitle,
      link: link ?? seriesLink,
    });
  }

  return {
    calendar: {
      id: source.id,
      name: source.name,
      external_calendar_id: source.external_calendar_id,
      sync_status: source.sync_status ?? "active",
    },
    date,
    time_zone: timeZone,
    range,
    items: report,
  };
}

/**
 * Runs one selected Google event through the normal inbound pipeline.
 * Existing linkage is preserved by `applyGoogleEvent` itself, so this is
 * idempotent and never touches unrelated events.
 */
export async function reapplyGoogleEvent(
  admin: Admin,
  familyId: string,
  sourceId: string,
  googleEventId: string,
): Promise<{ applied: boolean; skipped?: string; status?: string }> {
  const conn: ConnectionContext | null = await getConnection(admin, familyId);
  if (!conn) return { applied: false, skipped: "not_connected" };
  const source = await sourceById(admin, familyId, sourceId);
  if (!source || !source.external_calendar_id) {
    return { applied: false, skipped: "no_google_calendar" };
  }

  let g: GoogleEvent;
  try {
    g = await google.getEvent(conn.connectionKey, source.external_calendar_id, googleEventId);
  } catch (error) {
    console.error("[google-diagnostic] could not read Google event", googleEventId, error);
    return { applied: false, skipped: "google_event_unavailable" };
  }

  const initials = await initialsFor(admin, familyId);
  await applyGoogleEvent(admin, conn, source, g, initials);
  return { applied: true, status: g.status ?? "confirmed" };
}

export interface OccurrenceRecord {
  local_event_id: string;
  parent_event_id: string | null;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  external_event_id: string | null;
  external_recurring_event_id: string | null;
  recurrence_rule: string | null;
  recurrence_until: string | null;
  excluded_dates: string[];
  last_change_source: string | null;
  members: { family_member_id: string; name: string | null; weekdays: string[] | null }[];
  links: {
    id: string;
    branch_key: string;
    google_event_id: string;
    google_recurring_event_id: string | null;
    last_source: string;
    sync_error: string | null;
    calendar_source_id: string;
  }[];
}

export interface OccurrenceInspection {
  google_event_id: string;
  recurring_event_id: string | null;
  matches: OccurrenceRecord[];
  skipped?: string;
}

const EVENT_COLUMNS =
  "id, title, start_at, end_at, all_day, external_event_id, external_recurring_event_id, recurrence_rule, recurrence_until, excluded_dates, last_change_source";

async function recordFor(
  admin: Admin,
  familyId: string,
  eventId: string,
  parentEventId: string | null,
): Promise<OccurrenceRecord | null> {
  const { data: ev } = await admin
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("family_id", familyId)
    .eq("id", eventId)
    .maybeSingle();
  if (!ev) return null;
  const { data: memberRows } = await admin
    .from("event_members")
    .select("family_member_id, weekdays")
    .eq("event_id", eventId);
  const members: OccurrenceRecord["members"] = [];
  for (const m of (memberRows ?? []) as { family_member_id: string; weekdays: string[] | null }[]) {
    const { data: person } = await admin
      .from("family_members")
      .select("name")
      .eq("id", m.family_member_id)
      .maybeSingle();
    members.push({
      family_member_id: m.family_member_id,
      name: (person?.name as string | null) ?? null,
      weekdays: m.weekdays ?? null,
    });
  }
  const { data: linkRows } = await admin
    .from("event_sync_links")
    .select(
      "id, branch_key, google_event_id, google_recurring_event_id, last_source, sync_error, calendar_source_id",
    )
    .eq("family_id", familyId)
    .eq("event_id", eventId);
  return {
    local_event_id: eventId,
    parent_event_id: parentEventId,
    title: ev.title as string,
    start_at: ev.start_at as string,
    end_at: ev.end_at as string,
    all_day: Boolean(ev.all_day),
    external_event_id: (ev.external_event_id as string | null) ?? null,
    external_recurring_event_id: (ev.external_recurring_event_id as string | null) ?? null,
    recurrence_rule: (ev.recurrence_rule as string | null) ?? null,
    recurrence_until: (ev.recurrence_until as string | null) ?? null,
    excluded_dates: (ev.excluded_dates as string[] | null) ?? [],
    last_change_source: (ev.last_change_source as string | null) ?? null,
    members,
    links: (linkRows ?? []) as OccurrenceRecord["links"],
  };
}

/**
 * Read-only row-level inspection of one Google instance: every local event that
 * claims it (so duplicates are visible), its parent series, projection fields,
 * assignments and link bookkeeping. Writes nothing.
 */
export async function inspectOccurrence(
  admin: Admin,
  familyId: string,
  googleEventId: string,
): Promise<OccurrenceInspection> {
  const { data: linkRows } = await admin
    .from("event_sync_links")
    .select("event_id, google_recurring_event_id")
    .eq("family_id", familyId)
    .eq("google_event_id", googleEventId);
  const ids = new Set<string>();
  let recurringId: string | null = null;
  for (const l of (linkRows ?? []) as { event_id: string; google_recurring_event_id: string | null }[]) {
    ids.add(l.event_id);
    recurringId = recurringId ?? l.google_recurring_event_id;
  }

  const { data: stamped } = await admin
    .from("events")
    .select("id, external_recurring_event_id")
    .eq("family_id", familyId)
    .eq("external_event_id", googleEventId);
  for (const e of (stamped ?? []) as { id: string; external_recurring_event_id: string | null }[]) {
    ids.add(e.id);
    recurringId = recurringId ?? e.external_recurring_event_id;
  }

  // sibling one-offs of the same Google series make duplicate cards visible
  if (recurringId) {
    const { data: siblings } = await admin
      .from("events")
      .select("id")
      .eq("family_id", familyId)
      .eq("external_recurring_event_id", recurringId);
    for (const e of (siblings ?? []) as { id: string }[]) ids.add(e.id);
  }

  let parentEventId: string | null = null;
  if (recurringId) {
    const { data: parentLinks } = await admin
      .from("event_sync_links")
      .select("event_id")
      .eq("family_id", familyId)
      .eq("google_event_id", recurringId);
    parentEventId = ((parentLinks ?? [])[0]?.event_id as string | undefined) ?? null;
    if (parentEventId) ids.add(parentEventId);
  }

  if (ids.size === 0) {
    return { google_event_id: googleEventId, recurring_event_id: recurringId, matches: [], skipped: "no_local_rows" };
  }

  const matches: OccurrenceRecord[] = [];
  for (const id of ids) {
    const rec = await recordFor(admin, familyId, id, id === parentEventId ? null : parentEventId);
    if (rec) matches.push(rec);
  }
  return { google_event_id: googleEventId, recurring_event_id: recurringId, matches };
}
