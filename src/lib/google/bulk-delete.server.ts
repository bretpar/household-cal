import * as google from "@/lib/google/api.server";
import {
  eventMatchesFilters,
  previewIdentity,
  type BulkDeleteComparableEvent,
  type BulkDeleteFilters,
  type BulkDeletePreviewItem,
} from "@/lib/google/bulk-delete";
import { fromGoogleTimes, type GoogleEvent } from "@/lib/google/mapping";
import { getConnection } from "@/lib/google/sync.server";
import { normalizeTimeZone } from "@/lib/google/timezone";

type Admin = { from: (table: string) => any };

interface SourceRow {
  id: string;
  name: string;
  external_calendar_id: string | null;
}

interface LocalRow {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  recurrence_rule: string | null;
  external_recurring_event_id: string | null;
}

interface LinkRow {
  event_id: string;
  google_event_id: string;
  google_recurring_event_id: string | null;
  google_original_start: string | null;
}

export interface BulkDeletePreview {
  filters: BulkDeleteFilters;
  calendar: { id: string; name: string };
  time_zone: string;
  total: number;
  items: BulkDeletePreviewItem[];
  preview_token: string;
}

export interface BulkDeleteCompletion {
  deleted_from_google: number;
  deleted_from_ofc: number;
  failures: { title: string; date: string; message: string }[];
}

function zonedParts(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour") === "24" ? "00" : value("hour")}:${value("minute")}`,
  };
}

function offsetAt(utc: Date, timeZone: string): number {
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
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return (
    Date.UTC(
      value("year"),
      value("month") - 1,
      value("day"),
      value("hour") % 24,
      value("minute"),
      value("second"),
    ) - utc.getTime()
  );
}

function zonedMidnight(date: string, timeZone: string): Date {
  const naive = Date.parse(`${date}T00:00:00Z`);
  const guess = new Date(naive - offsetAt(new Date(naive), timeZone));
  return new Date(naive - offsetAt(guess, timeZone));
}

function nextDay(date: string): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function localComparable(row: LocalRow, timeZone: string): BulkDeleteComparableEvent {
  const start = zonedParts(row.start_at, timeZone);
  const end = zonedParts(row.end_at, timeZone);
  return {
    id: row.id,
    title: row.title,
    date: start.date,
    start_time: row.all_day ? null : start.time,
    end_time: row.all_day ? null : end.time,
    recurring: Boolean(row.recurrence_rule || row.external_recurring_event_id),
  };
}

function googleComparable(event: GoogleEvent, timeZone: string): BulkDeleteComparableEvent | null {
  const times = fromGoogleTimes(event);
  const start = event.start?.date
    ? { date: event.start.date, time: null }
    : { ...zonedParts(times.start_at, timeZone) };
  const end = event.end?.date
    ? { date: event.end.date, time: null }
    : { ...zonedParts(times.end_at, timeZone) };
  if (!start.date) return null;
  return {
    id: event.id,
    title: event.summary?.trim() || "(untitled)",
    date: start.date,
    start_time: event.start?.date ? null : start.time,
    end_time: event.end?.date ? null : end.time,
    recurring: Boolean(event.recurrence?.length || event.recurringEventId),
  };
}

async function hashPreview(filters: BulkDeleteFilters, identity: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(JSON.stringify(filters)).update("\n").update(identity).digest("hex");
}

async function resolveSource(
  admin: Admin,
  familyId: string,
  sourceId: string,
): Promise<SourceRow> {
  const { data, error } = await admin
    .from("calendar_sources")
    .select("id, name, external_calendar_id")
    .eq("id", sourceId)
    .eq("family_id", familyId)
    .eq("provider", "google")
    .maybeSingle();
  if (error) throw error;
  if (!data?.external_calendar_id) throw new Error("Choose a connected Google calendar");
  return data as SourceRow;
}

export async function previewBulkDelete(
  admin: Admin,
  familyId: string,
  filters: BulkDeleteFilters,
): Promise<BulkDeletePreview> {
  const source = await resolveSource(admin, familyId, filters.source_id);
  const externalCalendarId = source.external_calendar_id;
  if (!externalCalendarId) throw new Error("Choose a connected Google calendar");
  const connection = await getConnection(admin, familyId);
  if (!connection) throw new Error("Google Calendar is not connected");

  const { data: family } = await admin.from("families").select("timezone").eq("id", familyId).maybeSingle();
  const timeZone = normalizeTimeZone(family?.timezone as string | null);
  const timeMin = zonedMidnight(filters.start_date, timeZone).toISOString();
  const timeMax = zonedMidnight(nextDay(filters.end_date), timeZone).toISOString();

  const [{ data: memberRows }, { data: localRows, error: localError }, googleRows] = await Promise.all([
    admin.from("family_members").select("initial").eq("family_id", familyId),
    admin
      .from("events")
      .select("id, title, start_at, end_at, all_day, recurrence_rule, external_recurring_event_id")
      .eq("family_id", familyId)
      .eq("calendar_source_id", source.id)
      .gte("start_at", timeMin)
      .lt("start_at", timeMax),
    google.listEventsInRange(
      connection.connectionKey,
      externalCalendarId,
      timeMin,
      timeMax,
    ),
  ]);
  if (localError) throw localError;

  const initials = (memberRows ?? []).map((row: { initial: string }) => row.initial);
  const localMatches = ((localRows ?? []) as LocalRow[])
    .map((row) => ({ row, comparable: localComparable(row, timeZone) }))
    .filter(({ comparable }) => eventMatchesFilters(comparable, filters, initials));
  const localIds = localMatches.map(({ row }) => row.id);
  let links: LinkRow[] = [];
  if (localIds.length > 0) {
    const { data, error } = await admin
      .from("event_sync_links")
      .select("event_id, google_event_id, google_recurring_event_id, google_original_start")
      .eq("family_id", familyId)
      .eq("calendar_source_id", source.id)
      .in("event_id", localIds);
    if (error) throw error;
    links = (data ?? []) as LinkRow[];
  }

  const googleMatches = googleRows
    .filter((event) => event.status !== "cancelled")
    .map((event) => ({ event, comparable: googleComparable(event, timeZone) }))
    .filter(
      (entry): entry is { event: GoogleEvent; comparable: BulkDeleteComparableEvent } =>
        Boolean(entry.comparable && eventMatchesFilters(entry.comparable, filters, initials)),
    );
  const googleById = new Map(googleMatches.map((entry) => [entry.event.id, entry]));
  const items: BulkDeletePreviewItem[] = [];
  const claimedGoogleIds = new Set<string>();

  for (const local of localMatches) {
    const localLinks = links.filter(
      (link) =>
        link.event_id === local.row.id &&
        !link.google_recurring_event_id &&
        !link.google_original_start,
    );
    const liveMatches = localLinks
      .map((link) => googleById.get(link.google_event_id))
      .filter((entry): entry is { event: GoogleEvent; comparable: BulkDeleteComparableEvent } => Boolean(entry));
    const hasLiveLinkedMismatch = localLinks.some(
      (link) => googleRows.some((event) => event.id === link.google_event_id && event.status !== "cancelled") && !googleById.has(link.google_event_id),
    );
    if (hasLiveLinkedMismatch) continue;
    const googleIds = liveMatches.map((entry) => entry.event.id);
    googleIds.forEach((id) => claimedGoogleIds.add(id));
    items.push({
      key: `ofc:${local.row.id}`,
      title: local.comparable.title,
      date: local.comparable.date,
      start_time: local.comparable.start_time,
      end_time: local.comparable.end_time,
      calendar_name: source.name,
      exists_in: googleIds.length > 0 ? "Both" : "OFC",
      google_event_ids: googleIds,
      ofc_event_id: local.row.id,
    });
  }

  for (const { event, comparable } of googleMatches) {
    if (claimedGoogleIds.has(event.id)) continue;
    items.push({
      key: `google:${event.id}`,
      title: comparable.title,
      date: comparable.date,
      start_time: comparable.start_time,
      end_time: comparable.end_time,
      calendar_name: source.name,
      exists_in: "Google",
      google_event_ids: [event.id],
      ofc_event_id: null,
    });
  }

  items.sort((a, b) => `${a.date}${a.start_time ?? ""}${a.title}`.localeCompare(`${b.date}${b.start_time ?? ""}${b.title}`));
  const preview_token = await hashPreview(filters, previewIdentity(items));
  return {
    filters,
    calendar: { id: source.id, name: source.name },
    time_zone: timeZone,
    total: items.length,
    items,
    preview_token,
  };
}

export async function deleteBulkMatches(
  admin: Admin,
  familyId: string,
  filters: BulkDeleteFilters,
  expectedPreviewToken: string,
): Promise<BulkDeleteCompletion> {
  const preview = await previewBulkDelete(admin, familyId, filters);
  if (preview.preview_token !== expectedPreviewToken) {
    throw new Error("Matches changed since preview. Preview again before deleting.");
  }
  const source = await resolveSource(admin, familyId, filters.source_id);
  const externalCalendarId = source.external_calendar_id;
  if (!externalCalendarId) throw new Error("Choose a connected Google calendar");
  const connection = await getConnection(admin, familyId);
  if (!connection) throw new Error("Google Calendar is not connected");

  const result: BulkDeleteCompletion = {
    deleted_from_google: 0,
    deleted_from_ofc: 0,
    failures: [],
  };
  for (const item of preview.items) {
    try {
      for (const googleEventId of item.google_event_ids) {
        await google.deleteEvent(connection.connectionKey, externalCalendarId, googleEventId);
        result.deleted_from_google += 1;
      }
      if (item.ofc_event_id) {
        const { error } = await admin
          .from("events")
          .delete()
          .eq("id", item.ofc_event_id)
          .eq("family_id", familyId)
          .eq("calendar_source_id", source.id);
        if (error) throw error;
        result.deleted_from_ofc += 1;
      }
    } catch (error) {
      result.failures.push({
        title: item.title,
        date: item.date,
        message: error instanceof Error ? error.message : "Delete failed",
      });
    }
  }
  return result;
}