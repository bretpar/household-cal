import * as google from "@/lib/google/api.server";
import {
  classifyRecurrence,
  eventMatchesFilters,
  previewIdentity,
  statusReason,
  targetFromPreviewItem,
  targetIdentity,
  type BulkDeleteComparableEvent,
  type BulkDeleteFilters,
  type BulkDeletePreviewItem,
  type BulkDeleteTarget,
  type RecurrenceStatus,
} from "@/lib/google/bulk-delete";
import { fromGoogleTimes, type GoogleEvent } from "@/lib/google/mapping";
import { getConnection } from "@/lib/google/sync.server";
import { normalizeTimeZone } from "@/lib/google/timezone";

type Admin = { from: (table: string) => any };

/** Horizon used for "all future matching events" so Google expansion terminates. */
const FUTURE_HORIZON_YEARS = 10;
const LOCAL_PAGE_SIZE = 1000;

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
  eligible_total: number;
  protected_total: number;
  excluded_total: number;
  items: BulkDeletePreviewItem[];
  eligible_targets: BulkDeleteTarget[];
  preview_token: string;
}

export interface BulkDeleteCompletion {
  requested: number;
  deleted_from_google: number;
  deleted_from_ofc: number;
  skipped: number;
  failed: number;
  failures: { event_id: string; title: string; date: string; message: string }[];
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

function horizonDate(startDate: string): string {
  const at = new Date(`${startDate}T12:00:00Z`);
  at.setUTCFullYear(at.getUTCFullYear() + FUTURE_HORIZON_YEARS);
  return at.toISOString().slice(0, 10);
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
  };
}

function googleComparable(event: GoogleEvent, timeZone: string): BulkDeleteComparableEvent | null {
  const times = fromGoogleTimes(event);
  const start = event.start?.date
    ? { date: event.start.date, time: null as string | null }
    : { ...zonedParts(times.start_at, timeZone) };
  const end = event.end?.date
    ? { date: event.end.date, time: null as string | null }
    : { ...zonedParts(times.end_at, timeZone) };
  if (!start.date) return null;
  return {
    id: event.id,
    title: event.summary?.trim() || "(untitled)",
    date: start.date,
    start_time: event.start?.date ? null : start.time,
    end_time: event.end?.date ? null : end.time,
  };
}

async function hashPreview(filters: BulkDeleteFilters, identity: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256")
    .update(JSON.stringify(filters))
    .update("\n")
    .update(identity)
    .digest("hex");
}

async function resolveSource(admin: Admin, familyId: string, sourceId: string) {
  const { data, error } = await admin
    .from("calendar_sources")
    .select("id, name, external_calendar_id")
    .eq("id", sourceId)
    .eq("family_id", familyId)
    .eq("provider", "google")
    .maybeSingle();
  if (error) throw error;
  const row = data as SourceRow | null;
  if (!row?.external_calendar_id) throw new Error("Choose a connected Google calendar");
  return { id: row.id, name: row.name, external_calendar_id: row.external_calendar_id };
}

/** Cached master lookups so a whole broken series costs at most one probe. */
function masterProbe(connectionKey: string, calendarId: string) {
  const cache = new Map<string, "live_series" | "gone">();
  return async (recurringEventId: string): Promise<"live_series" | "gone"> => {
    const cached = cache.get(recurringEventId);
    if (cached) return cached;
    let state: "live_series" | "gone" = "gone";
    try {
      const master = await google.getEvent(connectionKey, calendarId, recurringEventId);
      if (master?.status !== "cancelled" && (master?.recurrence?.length ?? 0) > 0) {
        state = "live_series";
      }
    } catch {
      state = "gone";
    }
    cache.set(recurringEventId, state);
    return state;
  };
}

async function fetchLocalRows(
  admin: Admin,
  familyId: string,
  sourceId: string,
  timeMin: string,
  timeMax: string,
): Promise<LocalRow[]> {
  const rows: LocalRow[] = [];
  for (let page = 0; ; page += 1) {
    const { data, error } = await admin
      .from("events")
      .select("id, title, start_at, end_at, all_day, recurrence_rule, external_recurring_event_id")
      .eq("family_id", familyId)
      .eq("calendar_source_id", sourceId)
      .gte("start_at", timeMin)
      .lt("start_at", timeMax)
      .order("start_at", { ascending: true })
      .range(page * LOCAL_PAGE_SIZE, page * LOCAL_PAGE_SIZE + LOCAL_PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as LocalRow[];
    rows.push(...batch);
    if (batch.length < LOCAL_PAGE_SIZE) return rows;
  }
}

export async function previewBulkDelete(
  admin: Admin,
  familyId: string,
  filters: BulkDeleteFilters,
): Promise<BulkDeletePreview> {
  const source = await resolveSource(admin, familyId, filters.source_id);
  const connection = await getConnection(admin, familyId);
  if (!connection) throw new Error("Google Calendar is not connected");

  const { data: family } = await admin
    .from("families")
    .select("timezone")
    .eq("id", familyId)
    .maybeSingle();
  const timeZone = normalizeTimeZone(family?.timezone as string | null);
  const upperDate = filters.end_date ? nextDay(filters.end_date) : horizonDate(filters.start_date);
  const timeMin = zonedMidnight(filters.start_date, timeZone).toISOString();
  const timeMax = zonedMidnight(upperDate, timeZone).toISOString();

  const [{ data: memberRows }, localRows, googleRows] = await Promise.all([
    admin.from("family_members").select("initial").eq("family_id", familyId),
    fetchLocalRows(admin, familyId, source.id, timeMin, timeMax),
    google.listEventsInRange(
      connection.connectionKey,
      source.external_calendar_id,
      timeMin,
      timeMax,
    ),
  ]);

  const initials = (memberRows ?? []).map((row: { initial: string }) => row.initial);
  const localMatches = localRows
    .map((row) => ({ row, comparable: localComparable(row, timeZone) }))
    .filter(({ comparable }) => eventMatchesFilters(comparable, filters, initials));

  const localIds = localMatches.map(({ row }) => row.id);
  let links: LinkRow[] = [];
  if (localIds.length > 0) {
    for (let index = 0; index < localIds.length; index += 200) {
      const { data, error } = await admin
        .from("event_sync_links")
        .select("event_id, google_event_id, google_recurring_event_id, google_original_start")
        .eq("family_id", familyId)
        .eq("calendar_source_id", source.id)
        .in("event_id", localIds.slice(index, index + 200));
      if (error) throw error;
      links = links.concat((data ?? []) as LinkRow[]);
    }
  }

  const liveGoogleById = new Map<string, GoogleEvent>();
  for (const event of googleRows) {
    if (event.status !== "cancelled") liveGoogleById.set(event.id, event);
  }
  const googleMatches = googleRows
    .filter((event) => event.status !== "cancelled")
    .map((event) => ({ event, comparable: googleComparable(event, timeZone) }))
    .filter(
      (entry): entry is { event: GoogleEvent; comparable: BulkDeleteComparableEvent } =>
        Boolean(entry.comparable && eventMatchesFilters(entry.comparable, filters, initials)),
    );

  const probeMaster = masterProbe(connection.connectionKey, source.external_calendar_id);
  const googleStatus = new Map<string, RecurrenceStatus>();
  for (const { event } of googleMatches) {
    const recurringEventId = event.recurringEventId ?? null;
    const masterState = recurringEventId ? await probeMaster(recurringEventId) : null;
    googleStatus.set(
      event.id,
      classifyRecurrence({
        hasRecurrenceRule: (event.recurrence?.length ?? 0) > 0,
        recurringEventId,
        masterState,
      }),
    );
  }

  const items: BulkDeletePreviewItem[] = [];
  const claimedGoogleIds = new Set<string>();

  for (const local of localMatches) {
    const localLinks = links.filter((link) => link.event_id === local.row.id);
    const liveLinked = localLinks.filter((link) => liveGoogleById.has(link.google_event_id));
    const matchedLinked = liveLinked.filter((link) => googleStatus.has(link.google_event_id));
    const googleIds = matchedLinked.map((link) => link.google_event_id);
    googleIds.forEach((id) => claimedGoogleIds.add(id));

    let status: RecurrenceStatus;
    if (googleIds.length > 0) {
      // Google is authoritative for a linked event's recurrence health.
      status = googleIds.some((id) => googleStatus.get(id) === "healthy_recurring")
        ? "healthy_recurring"
        : googleIds.some((id) => googleStatus.get(id) === "detached")
          ? "detached"
          : "standalone";
    } else {
      const recurringPointer =
        local.row.external_recurring_event_id ??
        localLinks.find((link) => link.google_recurring_event_id)?.google_recurring_event_id ??
        (localLinks.some((link) => link.google_original_start) ? local.row.id : null);
      const masterState = local.row.external_recurring_event_id
        ? await probeMaster(local.row.external_recurring_event_id)
        : recurringPointer
          ? "gone"
          : null;
      status = classifyRecurrence({
        hasRecurrenceRule: Boolean(local.row.recurrence_rule),
        recurringEventId: recurringPointer,
        masterState,
      });
    }

    const mismatchedLinked = liveLinked.length > 0 && matchedLinked.length === 0;
    const eligible = status !== "healthy_recurring" && !mismatchedLinked;
    items.push({
      key: `ofc:${local.row.id}`,
      title: local.comparable.title,
      date: local.comparable.date,
      start_time: local.comparable.start_time,
      end_time: local.comparable.end_time,
      calendar_name: source.name,
      exists_in: googleIds.length > 0 ? "Both" : "OFC",
      recurrence_status: status,
      eligible,
      reason: mismatchedLinked
        ? "Linked Google event does not match these filters"
        : statusReason(status),
      google_event_ids: googleIds,
      ofc_event_id: local.row.id,
    });
  }

  for (const { event, comparable } of googleMatches) {
    if (claimedGoogleIds.has(event.id)) continue;
    const status = googleStatus.get(event.id) ?? "standalone";
    items.push({
      key: `google:${event.id}`,
      title: comparable.title,
      date: comparable.date,
      start_time: comparable.start_time,
      end_time: comparable.end_time,
      calendar_name: source.name,
      exists_in: "Google",
      recurrence_status: status,
      eligible: status !== "healthy_recurring",
      reason: statusReason(status),
      google_event_ids: [event.id],
      ofc_event_id: null,
    });
  }

  items.sort((a, b) =>
    `${a.date}${a.start_time ?? ""}${a.title}`.localeCompare(
      `${b.date}${b.start_time ?? ""}${b.title}`,
    ),
  );
  const eligible_total = items.filter((item) => item.eligible).length;
  const protected_total = items.filter(
    (item) => !item.eligible && item.recurrence_status === "healthy_recurring",
  ).length;
  const excluded_total = items.length - eligible_total - protected_total;
  const preview_token = await hashPreview(filters, previewIdentity(items));
  const eligible_targets = items.filter((item) => item.eligible).map(targetFromPreviewItem);
  return {
    filters,
    calendar: { id: source.id, name: source.name },
    time_zone: timeZone,
    total: items.length,
    eligible_total,
    protected_total,
    excluded_total,
    items,
    eligible_targets,
    preview_token,
  };
}

export async function deleteBulkMatches(
  admin: Admin,
  familyId: string,
  filters: BulkDeleteFilters,
  expectedPreviewToken: string,
  confirmedTargets: BulkDeleteTarget[],
): Promise<BulkDeleteCompletion> {
  const preview = await previewBulkDelete(admin, familyId, filters);
  if (preview.preview_token !== expectedPreviewToken) {
    throw new Error("Matches changed since preview. Preview again before deleting.");
  }
  if (targetIdentity(preview.eligible_targets) !== targetIdentity(confirmedTargets)) {
    throw new Error("Eligible event IDs changed since preview. Preview again before deleting.");
  }
  const source = await resolveSource(admin, familyId, filters.source_id);
  const connection = await getConnection(admin, familyId);
  if (!connection) throw new Error("Google Calendar is not connected");

  const result: BulkDeleteCompletion = {
    requested: confirmedTargets.length,
    deleted_from_google: 0,
    deleted_from_ofc: 0,
    skipped: preview.items.filter((item) => !item.eligible).length,
    failed: 0,
    failures: [],
  };

  for (const target of confirmedTargets) {
    try {
      for (const googleEventId of target.google_event_ids) {
        await google.deleteEvent(
          connection.connectionKey,
          source.external_calendar_id,
          googleEventId,
        );
        result.deleted_from_google += 1;
        // Drop the mirror link first so the cancellation cannot re-import later.
        const { error: linkError } = await admin
          .from("event_sync_links")
          .delete()
          .eq("family_id", familyId)
          .eq("calendar_source_id", source.id)
          .eq("google_event_id", googleEventId);
        if (linkError) throw linkError;
      }
      if (target.ofc_event_id) {
        const { error: linkError } = await admin
          .from("event_sync_links")
          .delete()
          .eq("family_id", familyId)
          .eq("calendar_source_id", source.id)
          .eq("event_id", target.ofc_event_id);
        if (linkError) throw linkError;
        const { error } = await admin
          .from("events")
          .delete()
          .eq("id", target.ofc_event_id)
          .eq("family_id", familyId)
          .eq("calendar_source_id", source.id);
        if (error) throw error;
        result.deleted_from_ofc += 1;
      }
    } catch (error) {
      result.failed += 1;
      result.failures.push({
        event_id: target.ofc_event_id ?? target.google_event_ids.join(", ") ?? target.key,
        title: target.title,
        date: target.date,
        message: error instanceof Error ? error.message : "Delete failed",
      });
    }
  }
  console.info("[bulk-delete] completed", {
    family_id: familyId,
    calendar_source_id: source.id,
    requested: result.requested,
    deleted_from_google: result.deleted_from_google,
    deleted_from_ofc: result.deleted_from_ofc,
    skipped: result.skipped,
    failed: result.failed,
  });
  return result;
}
