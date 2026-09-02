/**
 * Developer/owner-only Google backfill for one connected calendar.
 *
 * Normal sync is incremental: once a `google_sync_token` exists, Google only
 * returns objects that changed since that token, so an event that was missed
 * earlier is never reconsidered. This module performs a bounded *full-window*
 * listing (no sync token, `singleEvents=false`) and pushes every returned object
 * through the existing `applyGoogleEvent` pipeline, so recurring masters and
 * their exceptions are handled exactly like live sync.
 *
 * Deliberate constraints:
 * - the source's `google_sync_token` is never read, reset or written here, so
 *   normal incremental sync continues from the same token afterwards;
 * - cancellations are skipped: backfill only discovers/refreshes events, it
 *   never deletes local data;
 * - it is idempotent — already-linked objects fall through to the normal update
 *   path, which no-ops when nothing changed.
 *
 * Server-only.
 */
import * as google from "@/lib/google/api.server";
import {
  applyGoogleEvent,
  getConnection,
  initialsFor,
  type SourceRow,
} from "@/lib/google/sync.server";

type Admin = { from: (table: string) => any };

const SOURCE_COLUMNS =
  "id, family_id, name, external_calendar_id, is_main, google_sync_token, google_channel_id, google_channel_resource_id, sync_status, sync_failure_count, app_managed_calendar";

/** Default bounded window: 30 days back through 12 months ahead. */
export function backfillWindow(now: Date): { timeMin: string; timeMax: string } {
  const min = new Date(now.getTime());
  min.setUTCDate(min.getUTCDate() - 30);
  const max = new Date(now.getTime());
  max.setUTCFullYear(max.getUTCFullYear() + 1);
  return { timeMin: min.toISOString(), timeMax: max.toISOString() };
}

export interface BackfillSummary {
  calendar?: { id: string; name: string };
  range?: { timeMin: string; timeMax: string };
  examined: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errored: number;
  skippedReason?: string;
}

const EMPTY: BackfillSummary = {
  examined: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  skipped: 0,
  errored: 0,
};

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

async function linkSnapshot(
  admin: Admin,
  familyId: string,
  googleEventId: string,
): Promise<{ event_id: string; updated_at: string | null } | null> {
  const { data: link } = await admin
    .from("event_sync_links")
    .select("event_id")
    .eq("family_id", familyId)
    .eq("google_event_id", googleEventId)
    .maybeSingle();
  const eventId = (link?.event_id as string | undefined) ?? null;
  if (!eventId) return null;
  const { data: event } = await admin
    .from("events")
    .select("updated_at")
    .eq("id", eventId)
    .maybeSingle();
  return { event_id: eventId, updated_at: (event?.updated_at as string | null) ?? null };
}

/**
 * Full-window reconciliation for one Google calendar. Reuses the live inbound
 * pipeline for every object; only classification/counting lives here.
 */
export async function backfillSource(
  admin: Admin,
  familyId: string,
  sourceId: string,
  now = new Date(),
): Promise<BackfillSummary> {
  const conn = await getConnection(admin, familyId);
  if (!conn) return { ...EMPTY, skippedReason: "not_connected" };
  const source = await sourceById(admin, familyId, sourceId);
  if (!source || !source.external_calendar_id) {
    return { ...EMPTY, skippedReason: "no_google_calendar" };
  }

  const range = backfillWindow(now);
  // No syncToken on purpose: this is the full-window pass. singleEvents=false is
  // implied by the client when no token is supplied, so recurring masters arrive
  // as masters and exceptions as exceptions.
  const res = await google.listEvents(conn.connectionKey, source.external_calendar_id, range);

  const initials = await initialsFor(admin, familyId);
  const summary: BackfillSummary = {
    ...EMPTY,
    calendar: { id: source.id, name: source.name },
    range,
  };

  for (const item of res.items) {
    summary.examined += 1;
    if (!item.id) {
      summary.skipped += 1;
      continue;
    }
    if (item.status === "cancelled") {
      // backfill never deletes: cancellations remain the job of normal sync
      summary.skipped += 1;
      continue;
    }
    try {
      const before = await linkSnapshot(admin, familyId, item.id);
      await applyGoogleEvent(admin, conn, source, item, initials);
      const after = await linkSnapshot(admin, familyId, item.id);
      if (!before && after) summary.created += 1;
      else if (before && after && before.updated_at !== after.updated_at) summary.updated += 1;
      else if (before || after) summary.unchanged += 1;
      else summary.skipped += 1;
    } catch (error) {
      summary.errored += 1;
      console.error(
        "[google-backfill] failed to apply Google event",
        source.id,
        item.id,
        error instanceof Error ? error.message : error,
      );
    }
  }

  // Intentionally no calendar_sources update: the existing sync token and
  // status must stay exactly as normal sync left them.
  return summary;
}
