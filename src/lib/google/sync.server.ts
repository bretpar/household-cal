/**
 * Two-way Google Calendar synchronisation.
 *
 * Server-only. Every function here runs with the service-role client because it
 * has to write sync bookkeeping that no client may touch; household isolation is
 * enforced by always scoping queries to a `family_id` that the caller already
 * proved access to (or that came from a stored connection row).
 *
 * Direction of ownership:
 *  - Google owns title text, times, all-day, location, description, recurrence
 *    and cancellation.
 *  - The app owns family assignments, per-person weekday branches, event type,
 *    household permissions and every other app-only field. None of those are
 *    ever inferred from a Google title.
 */

import {
  branchAnchoredTimes,
  branchPushWeekdays,
  branchRecurrenceReview,
  branchTimeReview,
  branchTitleReview,
  calendarNameChange,
  cancellationAction,
  computeBranches,
  exceptionCancellationAction,
  exceptionEventFields,
  fromGoogleRecurrence,
  isExceptionLink,
  missingBranchKeys,
  obsoleteBranchLinks,
  occurrenceWallClockDrifted,
  remoteRecurringBodyIsStale,
  remoteRecurringTimesAreAmbiguous,
  originalStartKey,
  sameOriginalStart,
  localRuleFromGoogle,
  fromGoogleTimes,

  googleTitle,
  seriesPatchFromGoogle,
  sourceSyncPatch,
  shouldApplyGoogleChange,
  stripGeneratedSuffix,
  syncWindow,
  toGoogleRecurrence,
  toGoogleTimes,
  type GoogleDateTime,
  type GoogleEvent,
  type SyncBranch,
} from "@/lib/google/mapping";
import { decryptConnectionKey } from "@/lib/google/crypto.server";
import { normalizeTimeZone, timeZoneAction } from "@/lib/google/timezone";
import * as google from "@/lib/google/api.server";
import { GoogleAuthError } from "@/lib/google/api.server";
import type { WeekdayCode } from "@/lib/family-data";

type Admin = { from: (table: string) => any };

/**
 * Household IANA timezone: recurring Google series are anchored to local time,
 * never to the Google account's display timezone.
 */
async function householdTimeZone(admin: Admin, familyId: string): Promise<string> {
  const { data } = await admin
    .from("families")
    .select("timezone")
    .eq("id", familyId)
    .maybeSingle();
  return normalizeTimeZone(data?.timezone as string | null);
}

/**
 * Keeps a connected calendar's Google timezone in step with the household.
 * App-created calendars are corrected in place; calendars the household does not
 * manage are only recorded so Settings can warn about the mismatch.
 */
async function reconcileSourceTimeZone(
  admin: Admin,
  conn: ConnectionContext,
  source: SourceRow,
  remote: { timeZone?: string | undefined },
): Promise<string | null> {
  const household = await householdTimeZone(admin, source.family_id);
  const action = timeZoneAction({
    householdTimeZone: household,
    googleTimeZone: remote.timeZone,
    appManaged: source.app_managed_calendar === true,
  });
  if (action.kind === "ok") return remote.timeZone ?? null;
  if (action.kind === "warn") return action.googleTimeZone;
  try {
    await google.setCalendarTimeZone(
      conn.connectionKey,
      source.external_calendar_id!,
      action.timeZone,
    );
    return action.timeZone;
  } catch (error) {
    if (error instanceof GoogleAuthError) throw error;
    console.error("[google-sync] could not align calendar timezone", source.id, error);
    return remote.timeZone ?? null;
  }
}


export interface ConnectionContext {
  connectionId: string;
  familyId: string;
  connectionKey: string;
  accountEmail: string;
}

export interface SourceRow {
  id: string;
  family_id: string;
  name: string;
  external_calendar_id: string | null;
  is_main: boolean;
  google_sync_token: string | null;
  google_channel_id: string | null;
  google_channel_resource_id: string | null;
  sync_status?: string;
  sync_failure_count?: number;
  app_managed_calendar?: boolean;
}

interface EventRow {
  id: string;
  family_id: string;
  calendar_source_id: string | null;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  notes: string | null;
  event_type: string;
  recurrence_rule: string | null;
  recurrence_until: string | null;
  excluded_dates: string[] | null;
  updated_at: string;
  external_event_id?: string | null;
  external_recurring_event_id?: string | null;
  last_change_source?: string | null;
  event_members?: { family_member_id: string; weekdays: WeekdayCode[] | null }[];
}


interface LinkRow {
  id: string;
  event_id: string;
  calendar_source_id: string;
  google_event_id: string;
  google_recurring_event_id: string | null;
  /** Original start of the occurrence, for detached recurring exceptions. */
  google_original_start?: string | null;
  branch_key: string;
  google_etag: string | null;
  google_updated_at: string | null;
  last_source: "app" | "google";
  last_pushed_at: string | null;
}

/* ------------------------------------------------------------------ connection */

/** Returns the household's usable Google connection, or null when there is none. */
export async function getConnection(
  admin: Admin,
  familyId: string,
): Promise<ConnectionContext | null> {
  const { data } = await admin
    .from("google_connections")
    .select("id, family_id, account_email, status")
    .eq("family_id", familyId)
    .maybeSingle();
  if (!data || data.status !== "connected") return null;

  const { data: secret } = await admin
    .from("google_connection_secrets")
    .select("connection_key_ciphertext")
    .eq("connection_id", data.id)
    .maybeSingle();
  if (!secret) return null;

  return {
    connectionId: data.id,
    familyId: data.family_id,
    connectionKey: decryptConnectionKey(secret.connection_key_ciphertext),
    accountEmail: data.account_email,
  };
}

/** Marks the connection as needing a reconnect without touching local events. */
export async function markDisconnected(
  admin: Admin,
  familyId: string,
  reason: string,
): Promise<void> {
  await admin
    .from("google_connections")
    .update({ status: "disconnected", last_error: reason.slice(0, 500) })
    .eq("family_id", familyId);
}

async function googleSources(admin: Admin, familyId: string): Promise<SourceRow[]> {
  const { data } = await admin
    .from("calendar_sources")
    .select(
      "id, family_id, name, external_calendar_id, is_main, google_sync_token, google_channel_id, google_channel_resource_id, sync_status, sync_failure_count, app_managed_calendar",
    )
    .eq("family_id", familyId)
    .eq("provider", "google")
    .eq("sync_status", "active")
    .not("external_calendar_id", "is", null)
    .order("sort_order", { ascending: true });
  return (data ?? []) as SourceRow[];
}

/**
 * True when a link still points at an eligible active Google source *and* a
 * Google event that still exists.
 *
 * An unknown/transient answer counts as usable on purpose: keeping a link is
 * always safer than dropping it, because dropping it lets the push path create a
 * second copy of an event that was actually still there.
 */
async function linkIsUsable(
  conn: ConnectionContext,
  sources: SourceRow[],
  link: { calendar_source_id: string; google_event_id: string },
): Promise<boolean> {
  const source = sources.find((s) => s.id === link.calendar_source_id);
  if (!source?.external_calendar_id) return false;
  try {
    const state = await google.getEventState(
      conn.connectionKey,
      source.external_calendar_id,
      link.google_event_id,
    );
    return state !== "missing";
  } catch (error) {
    if (error instanceof GoogleAuthError) throw error;
    console.error("[google-sync] link verification failed", link.google_event_id, error);
    return true;
  }
}

/**
 * Removes the links of one event whose calendar or Google event is gone, so the
 * normal push path can recreate it in the currently eligible target calendar.
 * Valid links are left untouched.
 */
async function pruneStaleLinks(
  admin: Admin,
  conn: ConnectionContext,
  familyId: string,
  sources: SourceRow[],
  eventId: string,
): Promise<{ remaining: number; pruned: number }> {
  const { data } = await admin
    .from("event_sync_links")
    .select("id, calendar_source_id, google_event_id, google_recurring_event_id, google_original_start")
    .eq("family_id", familyId)
    .eq("event_id", eventId);
  const links = (data ?? []) as {
    id: string;
    calendar_source_id: string;
    google_event_id: string;
    google_recurring_event_id?: string | null;
    google_original_start?: string | null;
  }[];
  let remaining = 0;
  let pruned = 0;
  for (const link of links) {
    // A detached recurring exception is anchored by recurring id + original
    // start, not by its instance id, so a re-keyed instance must never look
    // stale here: dropping the link would strand or duplicate the occurrence.
    if (isExceptionLink(link)) {
      remaining += 1;
      continue;
    }
    if (await linkIsUsable(conn, sources, link)) {
      remaining += 1;
      continue;
    }
    await admin.from("event_sync_links").delete().eq("id", link.id);
    pruned += 1;
  }
  return { remaining, pruned };
}

/**
 * Leaves a breadcrumb when a push did not reach Google, so a silently unsynced
 * event is visible instead of invisible. Never throws: diagnostics must not
 * affect the local save.
 */
async function recordPushDiagnostic(
  admin: Admin,
  familyId: string,
  eventId: string,
  reason: string,
): Promise<void> {
  console.warn("[google-sync] push not completed", eventId, reason);
  try {
    await admin
      .from("event_sync_links")
      .update({ sync_error: reason.slice(0, 500) })
      .eq("family_id", familyId)
      .eq("event_id", eventId);
  } catch (error) {
    console.error("[google-sync] diagnostic write failed", error);
  }
}

/**
 * Version of the body we send to Google. Bumped when the generated recurrence
 * metadata itself changes, so a one-time repatch can find pre-fix series.
 *
 * 2 = timed events carry household-local wall-clock times + IANA zone (DST-safe).
 */
export const SYNC_BODY_VERSION = 2;

/**
 * True when a healthy recurring timed event still carries pre-DST-fix Google
 * recurrence metadata and must be patched in place once.
 */
async function needsBodyRepatch(
  admin: Admin,
  familyId: string,
  event: { recurrence_rule: string | null; all_day: boolean },
  eventId: string,
): Promise<boolean> {
  if (!event.recurrence_rule || event.all_day) return false;
  const { data } = await admin
    .from("event_sync_links")
    .select("app_version")
    .eq("family_id", familyId)
    .eq("event_id", eventId)
    .lt("app_version", SYNC_BODY_VERSION);
  return ((data ?? []) as unknown[]).length > 0;
}

/**
 * True when an event still has live links for branch keys the current
 * representation no longer wants — the signature of an unfinished shared <->
 * per-person conversion. Those series are alive in Google, so link pruning
 * alone never sees them.
 */
async function hasObsoleteBranchLinks(
  admin: Admin,
  familyId: string,
  eventId: string,
): Promise<boolean> {
  const event = await loadEvent(admin, eventId);
  if (!event) return false;
  const participants = (event.event_members ?? []).map((m) => ({
    member_id: m.family_member_id,
    weekdays: m.weekdays,
  }));
  const branches = computeBranches({
    recurrence_rule: event.recurrence_rule,
    participants,
    member_ids: participants.map((p) => p.member_id),
  });
  const { data } = await admin
    .from("event_sync_links")
    .select("branch_key, google_recurring_event_id, google_original_start")
    .eq("family_id", familyId)
    .eq("event_id", eventId);
  const links = (data ?? []) as {
    branch_key: string;
    google_recurring_event_id: string | null;
    google_original_start: string | null;
  }[];
  return obsoleteBranchLinks(branches.map((b) => b.key), links).length > 0;
}

/**
 * True when a desired branch has no parent link at all — the signature of a
 * push whose Google write landed but whose link row never persisted.
 */
async function hasMissingBranchLinks(
  admin: Admin,
  familyId: string,
  eventId: string,
): Promise<boolean> {
  const event = await loadEvent(admin, eventId);
  if (!event) return false;
  const participants = (event.event_members ?? []).map((m) => ({
    member_id: m.family_member_id,
    weekdays: m.weekdays,
  }));
  const branches = computeBranches({
    recurrence_rule: event.recurrence_rule,
    participants,
    member_ids: participants.map((p) => p.member_id),
  });
  const { data } = await admin
    .from("event_sync_links")
    .select("branch_key, google_recurring_event_id, google_original_start")
    .eq("family_id", familyId)
    .eq("event_id", eventId);
  const links = (data ?? []) as {
    branch_key: string;
    google_recurring_event_id: string | null;
    google_original_start: string | null;
  }[];
  return missingBranchKeys(branches.map((b) => b.key), links).length > 0;
}

export interface StaleRecurringBranch {
  linkId: string;
  googleEventId: string;
  calendarId: string;
  reason: string;
  body: Record<string, unknown>;
}

/**
 * Collects the linked recurring timed branches whose live Google master still
 * carries stale time/recurrence metadata (fixed offsets, wrong timezone) even
 * though the link looks current. Classification is unchanged: the remote body is
 * compared against what `branchBody()` would send today, with one expanded
 * post-DST occurrence as the tie-breaker for an ambiguous body.
 */
async function staleRecurringBranches(
  admin: Admin,
  conn: ConnectionContext,
  familyId: string,
  sources: SourceRow[],
  eventId: string,
): Promise<StaleRecurringBranch[]> {
  const event = await loadEvent(admin, eventId);
  if (!event || !event.recurrence_rule || event.all_day) return [];

  const participants = (event.event_members ?? []).map((m) => ({
    member_id: m.family_member_id,
    weekdays: m.weekdays,
  }));
  const branches = computeBranches({
    recurrence_rule: event.recurrence_rule,
    participants,
    member_ids: participants.map((p) => p.member_id),
  });
  const { data } = await admin
    .from("event_sync_links")
    .select(
      "id, branch_key, google_event_id, calendar_source_id, google_recurring_event_id, google_original_start",
    )
    .eq("family_id", familyId)
    .eq("event_id", eventId);
  const links = (data ?? []) as (LinkRow & { id: string })[];
  const initials = await initialsFor(admin, familyId);
  const timeZone = await householdTimeZone(admin, familyId);
  const stale: StaleRecurringBranch[] = [];

  for (const branch of branches) {
    const link = links.find((l) => l.branch_key === branch.key);
    if (!link || isExceptionLink(link)) continue;
    const source = sources.find((s) => s.id === link.calendar_source_id);
    if (!source?.external_calendar_id) continue;
    let remote: GoogleEvent;
    try {
      remote = await google.getEvent(
        conn.connectionKey,
        source.external_calendar_id,
        link.google_event_id,
      );
    } catch {
      continue; // unreachable master is handled by the stale-link path
    }
    const body = branchBody(event, branch, initials, timeZone);
    const expected = body as {
      start?: GoogleDateTime;
      end?: GoogleDateTime;
      recurrence?: string[] | null;
    };
    const found = (reason: string) =>
      stale.push({
        linkId: link.id,
        googleEventId: link.google_event_id,
        calendarId: source.external_calendar_id!,
        reason,
        body,
      });

    if (remoteRecurringBodyIsStale(expected, remote)) {
      found("master_body_differs_from_expected(start/end/timeZone/recurrence)");
      continue;
    }
    // The raw body can look right yet still expand with fixed-offset semantics
    // (offset-bearing dateTime, missing/non-IANA zone). In that case the truth is
    // one expanded occurrence after the next DST transition: if its local
    // wall-clock time drifted, the master is repatched in place.
    if (remoteRecurringTimesAreAmbiguous(remote)) {
      try {
        const probeMin = new Date(Date.now()).toISOString();
        const probeMax = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString();
        const instances = await google.listInstances(
          conn.connectionKey,
          source.external_calendar_id,
          link.google_event_id,
          probeMin,
          probeMax,
        );
        for (const instance of instances) {
          if (instance.status === "cancelled") continue;
          if (occurrenceWallClockDrifted(expected.start?.dateTime, instance.start, timeZone)) {
            found("expanded_occurrence_local_wall_clock_drifted");
            break;
          }
        }
      } catch {
        // probe failures never force a repatch
      }
    }
  }
  return stale;
}

/** Writable Google event fields carried over verbatim by a DST full update. */
const DST_PRESERVED_FIELDS = [
  "summary",
  "description",
  "location",
  "reminders",
  "visibility",
  "transparency",
  "attendees",
  "extendedProperties",
  "colorId",
  "status",
  "guestsCanInviteOthers",
  "guestsCanModify",
  "guestsCanSeeOtherGuests",
  "anyoneCanAddSelf",
  "attachments",
  "conferenceData",
  "source",
  "eventType",
  "sequence",
] as const;

/**
 * Builds a full writable event body for the DST repair PUT: existing writable
 * metadata from the live master is preserved and only start/end/recurrence are
 * overwritten with the already-generated DST-safe values.
 */
export function dstFullUpdateBody(
  remote: Record<string, unknown>,
  repair: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const field of DST_PRESERVED_FIELDS) {
    if (remote[field] !== undefined && remote[field] !== null) body[field] = remote[field];
  }
  body["start"] = repair["start"];
  body["end"] = repair["end"];
  if (repair["recurrence"] !== undefined) body["recurrence"] = repair["recurrence"];
  return body;
}

/**
 * Executes the already-generated repair body against the SAME Google master for
 * every stale branch: a full PUT update on the existing `google_event_id` (a
 * PATCH can be a semantic no-op for these equivalent-instant bodies), so the
 * local event id, the link id and the Google master id are all preserved and no
 * replacement series is ever created. A healthy master is never repaired again.
 */
export async function repairStaleRecurringBodies(
  admin: Admin,
  conn: ConnectionContext,
  familyId: string,
  sources: SourceRow[],
  eventId: string,
): Promise<{ repaired: number; failed: number }> {
  const stale = await staleRecurringBranches(admin, conn, familyId, sources, eventId);
  let repaired = 0;
  let failed = 0;

  for (const branch of stale) {
    try {
      const remote = await google.getEventRaw(
        conn.connectionKey,
        branch.calendarId,
        branch.googleEventId,
      );
      const saved = await google.updateEvent(
        conn.connectionKey,
        branch.calendarId,
        branch.googleEventId,
        dstFullUpdateBody(remote, branch.body),
      );
      await admin
        .from("event_sync_links")
        .update({
          google_etag: saved.etag ?? null,
          google_updated_at: saved.updated ?? null,
          last_source: "app",
          last_pushed_at: new Date().toISOString(),
          app_version: SYNC_BODY_VERSION,
          sync_error: null,
          dst_repair: {
            attempted: true,
            method: "update",
            success: true,
            error: null,
            updated: saved.updated ?? null,
            etag: saved.etag ?? null,
            reason: branch.reason,
            at: new Date().toISOString(),
          },
        })
        .eq("id", branch.linkId);
      repaired += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      console.error("[google-sync] DST repair write failed", branch.googleEventId, message);
      failed += 1;
      // Never mark a failed repair as complete: the link keeps its old version
      // so the next reconcile classifies it STALE again and retries.
      await admin
        .from("event_sync_links")
        .update({
          sync_error: `dst_repair_failed: ${message}`.slice(0, 500),
          dst_repair: {
            attempted: true,
            method: "update",
            success: false,
            error: message.slice(0, 500),
            updated: null,
            etag: null,
            reason: branch.reason,
            at: new Date().toISOString(),
          },
        })
        .eq("id", branch.linkId);
    }
  }
  return { repaired, failed };
}



/** Wraps sync work so an expired/revoked Google grant degrades gracefully. */
async function guard<T>(
  admin: Admin,
  familyId: string,
  work: () => Promise<T>,
): Promise<T | { skipped: string }> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      await markDisconnected(admin, familyId, error.message);
      return { skipped: "google_disconnected" };
    }
    console.error("[google-sync] failed", error);
    return { skipped: error instanceof Error ? error.message : "unknown_error" };
  }
}

/* ------------------------------------------------------------- app -> google */

async function loadEvent(admin: Admin, eventId: string): Promise<EventRow | null> {
  const { data } = await admin
    .from("events")
    .select("*, event_members(family_member_id, weekdays)")
    .eq("id", eventId)
    .maybeSingle();
  return (data as EventRow) ?? null;
}

export async function initialsFor(admin: Admin, familyId: string): Promise<Map<string, string>> {
  const { data } = await admin
    .from("family_members")
    .select("id, initial, sort_order")
    .eq("family_id", familyId)
    .order("sort_order", { ascending: true });
  return new Map(((data ?? []) as { id: string; initial: string }[]).map((m) => [m.id, m.initial]));
}

function branchInitials(branch: SyncBranch, initials: Map<string, string>): string[] {
  return branch.memberIds.map((id) => initials.get(id)).filter((v): v is string => Boolean(v));
}

function branchBody(
  event: EventRow,
  branch: SyncBranch,
  initials: Map<string, string>,
  timeZone: string,
): Record<string, unknown> {
  // each branch is anchored to its own first matching weekday so Google does
  // not also emit it on the shared series' start weekday
  // a shared branch inherits the rule's own BYDAY, so a start weekday that is no
  // longer active never leaks out as an extra Google occurrence
  const pushWeekdays = branchPushWeekdays(branch.weekdays, event.recurrence_rule);
  const anchored = branchAnchoredTimes(
    event.start_at,
    event.end_at,
    pushWeekdays,
    event.all_day ? null : timeZone,
  );

  const times = toGoogleTimes(anchored.startAt, anchored.endAt, event.all_day, timeZone);

  const recurrence = toGoogleRecurrence(
    event.recurrence_rule,
    pushWeekdays,
    event.recurrence_until,
    event.excluded_dates ?? [],
    event.all_day ? null : { startAt: anchored.startAt, timeZone },
  );
  return {
    summary: googleTitle(event.title, branchInitials(branch, initials)),
    description: event.notes ?? "",
    location: event.location ?? "",
    start: times.start,
    end: times.end,
    ...(recurrence ? { recurrence } : { recurrence: null }),
  };
}

/**
 * Pushes one app event to Google as one Google series per participation branch.
 *
 * "School" with Bailey Mon–Thu and Ellison Tue–Thu becomes `School - B` on
 * Mondays and `School - B & E` on Tue–Thu, both linked back to the same app
 * event through `branch_key`.
 */
export async function pushEvent(
  admin: Admin,
  familyId: string,
  eventId: string,
): Promise<{ pushed?: number; skipped?: string }> {
  const result = await guard(admin, familyId, async () => {
    const conn = await getConnection(admin, familyId);
    if (!conn) return { skipped: "not_connected" };

    const event = await loadEvent(admin, eventId);
    if (!event || event.family_id !== familyId) return { skipped: "event_not_found" };

    // A detached instance that came *from* Google already exists there as an
    // exception of its parent series. Creating it again would produce a second,
    // standalone Google event for the same occurrence, so an untouched
    // Google-origin exception is never pushed outbound. A genuine later local
    // edit flips last_change_source back to "app" and pushes normally.
    if (event.external_recurring_event_id && (event.last_change_source ?? "app") === "google") {
      const { data: ownLinks } = await admin
        .from("event_sync_links")
        .select("id")
        .eq("family_id", familyId)
        .eq("event_id", eventId);
      if ((ownLinks ?? []).length === 0) return { skipped: "google_owned_exception" };
    }


    const sources = await googleSources(admin, familyId);
    if (sources.length === 0) return { skipped: "no_google_calendar" };
    const target =
      sources.find((s) => s.id === event.calendar_source_id) ??
      sources.find((s) => s.is_main) ??
      sources[0]!;

    const initials = await initialsFor(admin, familyId);
    const participants = (event.event_members ?? []).map((m) => ({
      member_id: m.family_member_id,
      weekdays: m.weekdays,
    }));
    const branches = computeBranches({
      recurrence_rule: event.recurrence_rule,
      participants,
      member_ids: participants.map((p) => p.member_id),
    });

    const { data: linkRows } = await admin
      .from("event_sync_links")
      .select("*")
      .eq("event_id", eventId);
    const allLinks = (linkRows ?? []) as LinkRow[];

    // Obsolete branch series are removed BEFORE the desired ones are written.
    // The save path is time-limited, so doing it the other way round can leave a
    // live stale series behind (shared <-> per-person conversions), which later
    // reconciliation would then treat as healthy.
    const obsolete = obsoleteBranchLinks(
      branches.map((b) => b.key),
      allLinks,
    );
    for (const stale of obsolete) {
      const source = sources.find((s) => s.id === stale.calendar_source_id);
      if (source?.external_calendar_id) {
        await google.deleteEvent(
          conn.connectionKey,
          source.external_calendar_id,
          stale.google_event_id,
        );
      }
      await admin.from("event_sync_links").delete().eq("id", stale.id);
    }
    const obsoleteIds = new Set(obsolete.map((l) => l.id));
    const links = allLinks.filter((l) => !obsoleteIds.has(l.id));

    const timeZone = await householdTimeZone(admin, familyId);
    let pushed = 0;
    for (const branch of branches) {
      const body = branchBody(event, branch, initials, timeZone);
      const link = links.find((l) => l.branch_key === branch.key);

      // Temporary diagnostic: verify DST Clean Test sends 09:00 + America/Los_Angeles
      if (event.recurrence_rule && !event.all_day) {
        const start = (body["start"] ?? {}) as GoogleDateTime;
        const end = (body["end"] ?? {}) as GoogleDateTime;
        console.log("[google-sync-diag] recurring timed push", {
          action: link ? "PATCH" : "INSERT",
          eventId,
          googleEventId: link?.google_event_id ?? null,
          calendarSourceId: target.id,
          timeZone,
          startDateTime: start.dateTime ?? null,
          startTimeZone: start.timeZone ?? null,
          endDateTime: end.dateTime ?? null,
          endTimeZone: end.timeZone ?? null,
          recurrence: body["recurrence"] ?? null,
        });
      }
      let saved: GoogleEvent;

      if (link) {
        // moved to the other connected calendar in the app: move it in Google too,
        // keeping the same Google event id so history and invites survive
        if (link.calendar_source_id !== target.id) {
          const from = sources.find((s) => s.id === link.calendar_source_id);
          if (from?.external_calendar_id) {
            await google.moveEvent(
              conn.connectionKey,
              from.external_calendar_id,
              link.google_event_id,
              target.external_calendar_id!,
            );
          }
        }
        saved = await google.patchEvent(
          conn.connectionKey,
          target.external_calendar_id!,
          link.google_event_id,
          body,
        );
      } else {
        saved = await google.insertEvent(conn.connectionKey, target.external_calendar_id!, body);
      }

      const { error: linkError } = await admin.from("event_sync_links").upsert(
        {
          family_id: familyId,
          event_id: eventId,
          calendar_source_id: target.id,
          google_event_id: saved.id,
          google_recurring_event_id: saved.recurringEventId ?? null,
          branch_key: branch.key,
          google_etag: saved.etag ?? null,
          google_updated_at: saved.updated ?? null,
          last_source: "app",
          last_pushed_at: new Date().toISOString(),
          app_version: SYNC_BODY_VERSION,
          sync_error: null,

        },
        { onConflict: "event_id,branch_key" },
      );
      // A Google write that lands without its link row is the worst outcome:
      // inbound sync later imports the orphaned series as a standalone event.
      // Surface it instead of silently reporting a successful push.
      if (linkError) {
        console.error("[google-sync] branch link upsert failed", eventId, branch.key, linkError);
        throw new Error(
          `event_sync_links upsert failed for branch "${branch.key}": ${linkError.message ?? String(linkError)}`,
        );
      }
      pushed += 1;
    }



    await touchSynced(admin, familyId);
    return { pushed };
  });
  const outcome = result as { pushed?: number; skipped?: string };
  if (outcome.skipped && outcome.skipped !== "event_not_found") {
    await recordPushDiagnostic(admin, familyId, eventId, outcome.skipped);
  }
  return outcome;
}

/** Mirrors an app-side delete (whole event or truncated series) onto Google. */
export async function pushEventDeletion(
  admin: Admin,
  familyId: string,
  links: { google_event_id: string; calendar_source_id: string }[],
): Promise<void> {
  await guard(admin, familyId, async () => {
    const conn = await getConnection(admin, familyId);
    if (!conn) return { skipped: "not_connected" };
    const sources = await googleSources(admin, familyId);
    for (const link of links) {
      const source = sources.find((s) => s.id === link.calendar_source_id);
      if (source?.external_calendar_id) {
        await google.deleteEvent(
          conn.connectionKey,
          source.external_calendar_id,
          link.google_event_id,
        );
      }
    }
    return { ok: true };
  });
}

/** Reads the links for an event before it is deleted locally. */
export async function linksForEvent(
  admin: Admin,
  eventId: string,
): Promise<{ google_event_id: string; calendar_source_id: string }[]> {
  const { data } = await admin
    .from("event_sync_links")
    .select("google_event_id, calendar_source_id")
    .eq("event_id", eventId);
  return data ?? [];
}

async function touchSynced(admin: Admin, familyId: string): Promise<void> {
  await admin
    .from("google_connections")
    .update({ last_synced_at: new Date().toISOString(), last_error: null })
    .eq("family_id", familyId);
}

/* ------------------------------------------------------------- google -> app */

function dayOf(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

async function addExcludedDate(admin: Admin, eventId: string, day: string): Promise<void> {
  const { data } = await admin
    .from("events")
    .select("excluded_dates")
    .eq("id", eventId)
    .maybeSingle();
  const current: string[] = data?.excluded_dates ?? [];
  if (current.includes(day)) return;
  await admin
    .from("events")
    .update({ excluded_dates: [...current, day], last_change_source: "google" })
    .eq("id", eventId);
}

/**
 * Applies one Google event to the app.
 *
 * Instance-level changes become an occurrence exception (excluded date on the
 * series + a detached one-off event), exactly like the app's own
 * "this event only" edit. Series-level changes update the matching branch only.
 */
export async function applyGoogleEvent(
  admin: Admin,
  conn: ConnectionContext,
  source: SourceRow,
  g: GoogleEvent,
  initials: Map<string, string>,
): Promise<void> {
  const familyId = source.family_id;
  const { data: linkRows } = await admin
    .from("event_sync_links")
    .select("*")
    .eq("google_event_id", g.id)
    .eq("family_id", familyId)
    .order("created_at", { ascending: true })
    .limit(1);
  let link = ((linkRows ?? [])[0] as LinkRow | undefined) ?? null;


  /* ---------- cancellations ---------- */
  if (g.status === "cancelled") {
    if (link && isExceptionLink(link)) {
      // Detaching an occurrence makes Google report the *original* occurrence as
      // cancelled, and a later sync can re-key the detached instance. So only a
      // confirmed deletion of the detached occurrence itself may remove it; the
      // parent's exclusion is left in place either way.
      const state = await detachedOccurrenceState(conn, source, link);
      if (state.status === "live" && state.event && state.event.id !== link.google_event_id) {
        await adoptOccurrenceIdentity(admin, link, state.event);
      }
      if (exceptionCancellationAction({ occurrenceState: state.status }) === "remove") {
        await admin.from("events").delete().eq("id", link.event_id);
      }
      return;
    }
    if (link) {
      // A tombstone can be stale, or the leftover of a cross-calendar move, so
      // never delete before Google confirms this exact event is really gone.
      let remoteState: "live" | "cancelled" | "missing" | "unknown" = "unknown";
      if (link.calendar_source_id === source.id && source.external_calendar_id) {
        try {
          remoteState = await google.getEventState(
            conn.connectionKey,
            source.external_calendar_id,
            g.id,
          );
        } catch (error) {
          if (error instanceof GoogleAuthError) throw error;
          console.error("[google-sync] cancellation verification failed", error);
          remoteState = "unknown";
        }
      }
      const action = cancellationAction({
        link,
        sourceId: source.id,
        googleEventId: g.id,
        remoteState,
      });
      if (action === "ignore") return;

      const { data: siblings } = await admin
        .from("event_sync_links")
        .select("id")
        .eq("event_id", link.event_id);
      // deleting one Google branch removes only that branch of the logical event
      if ((siblings ?? []).length > 1) {
        await admin.from("event_sync_links").delete().eq("id", link.id);
        await removeBranchParticipation(admin, link);
      } else {
        await admin.from("events").delete().eq("id", link.event_id);
      }
      return;
    }
    // Cancelled single occurrence of a series we know about. A live detached
    // exception may already represent it (that is what detaching looks like in
    // Google), so nothing local is deleted here — only the parent exclusion is
    // (re)asserted, which is exactly the app's own "this event only" semantics.
    if (g.recurringEventId) {
      const { data: seriesLink } = await admin
        .from("event_sync_links")
        .select("event_id, calendar_source_id")
        .eq("google_event_id", g.recurringEventId)
        .eq("family_id", familyId)
        .maybeSingle();
      const day = dayOf(g.originalStartTime?.date ?? g.originalStartTime?.dateTime);
      if (seriesLink && seriesLink.calendar_source_id === source.id && day) {
        await addExcludedDate(admin, seriesLink.event_id, day);
      }
    }
    return;
  }

  /* ---------- single-occurrence exception of a known series ---------- */
  if (!link && g.recurringEventId) {
    // family-scoped: the parent branch may live in the other connected calendar
    const { data: seriesLinks } = await admin
      .from("event_sync_links")
      .select("event_id, branch_key, calendar_source_id")
      .eq("google_event_id", g.recurringEventId)
      .eq("family_id", familyId);
    type SeriesLinkRow = { event_id: string; branch_key: string | null; calendar_source_id: string };
    const candidates = (seriesLinks ?? []) as SeriesLinkRow[];
    const seriesLink =
      candidates.find((l: SeriesLinkRow) => l.calendar_source_id === source.id) ??
      candidates[0] ??
      null;
    if (seriesLink) {
      const day = dayOf(g.originalStartTime?.date ?? g.originalStartTime?.dateTime);
      if (day) await addExcludedDate(admin, seriesLink.event_id, day);

      // Idempotency: a local detached exception for this exact Google instance
      // may already exist (earlier inbound pass, a pruned link row, or the same
      // instance seen through another connected calendar). Reuse it instead of
      // creating a second local card for the same occurrence.
      const detached = await findDetachedException(admin, familyId, source.id, g);
      const eventId =
        detached ??
        (await createExceptionEvent(
          admin,
          source,
          g,
          initials,
          seriesLink.event_id,
          seriesLink.branch_key ?? "",
        ));
      if (!eventId) return;
      // keep the Google linkage (instance id / recurringEventId) authoritative
      await admin
        .from("events")
        .update({
          external_event_id: g.id,
          external_recurring_event_id: g.recurringEventId,
          last_change_source: "google",
        })
        .eq("id", eventId);
      await admin.from("event_sync_links").upsert(
        {
          family_id: familyId,
          event_id: eventId,
          calendar_source_id: source.id,
          google_event_id: g.id,
          google_recurring_event_id: g.recurringEventId,
          google_original_start: originalStartKey(g.originalStartTime),
          branch_key: "",
          google_etag: g.etag ?? null,
          google_updated_at: g.updated ?? null,
          last_source: "google",
        },
        { onConflict: "event_id,branch_key" },
      );
      if (!detached) return;
      // an already-known exception falls through to the normal update path so a
      // fresh Google edit of the same occurrence is applied in place
      const { data: adoptedRows } = await admin
        .from("event_sync_links")
        .select("*")
        .eq("family_id", familyId)
        .eq("event_id", eventId)
        .order("created_at", { ascending: true })
        .limit(1);
      link = ((adoptedRows ?? [])[0] as LinkRow | undefined) ?? null;
      if (!link) return;

    }
  }




  /* ---------- brand new Google event ---------- */
  if (!link) {
    // reuse an existing local row for this Google id when its link row is gone,
    // so a pruned link never produces a duplicate local copy
    // A master this household already knows must never become a second local
    // card: recover the existing local event by its Google id (link row or the
    // event's own Google columns) before falling back to creating one.
    // Match on the exact Google id only. Matching a recurring-parent id would
    // adopt a detached exception / materialized occurrence row (those store the
    // master id in *_recurring_event_id), which would overwrite that one-off
    // change and leave the series with no local card of its own.
    const { data: knownLink } = await admin
      .from("event_sync_links")
      .select("event_id")
      .eq("family_id", familyId)
      .eq("google_event_id", g.id)
      .limit(1)
      .maybeSingle();
    const { data: existingLocal } = await admin
      .from("events")
      .select("id")
      .eq("family_id", familyId)
      .eq("external_event_id", g.id)
      .limit(1)
      .maybeSingle();
    const recovered =
      (knownLink?.event_id as string | undefined) ?? (existingLocal?.id as string | undefined);

    const newId = recovered ?? (await createLocalEvent(admin, source, g, initials, null));
    await admin.from("event_sync_links").upsert(
      {
        family_id: familyId,
        event_id: newId,
        calendar_source_id: source.id,
        google_event_id: g.id,
        google_recurring_event_id: g.recurringEventId ?? null,
        branch_key: "",
        google_etag: g.etag ?? null,
        google_updated_at: g.updated ?? null,
        last_source: "google",
      },
      { onConflict: "event_id,branch_key" },
    );
    return;
  }


  /* ---------- update of a linked event ---------- */
  const { data: event } = await admin
    .from("events")
    .select("*, event_members(family_member_id, weekdays)")
    .eq("id", link.event_id)
    .maybeSingle();
  if (!event) return;

  if (
    !shouldApplyGoogleChange(
      link,
      { etag: g.etag, updated: g.updated },
      { updated_at: event.updated_at, last_change_source: event.last_change_source },
    )
  ) {
    return;
  }

  const branch = branchForLink(event, link, initials);
  // per-person weekday branches share one local start/end: a Google time edit on
  // a single branch is flagged for review instead of moving every branch
  const timeReview = branchTimeReview({
    local: {
      branchKey: link.branch_key ?? "",
      start_at: event.start_at,
      end_at: event.end_at,
      all_day: event.all_day,
    },
    google: g,
  });
  if (timeReview) console.warn("[google-sync] unsupported branch time edit", link.id, timeReview);
  // per-person weekday branches share one local title: a Google rename of a
  // single branch is flagged for review instead of retitling every branch
  const titleReview = branchTitleReview({
    local: { branchKey: link.branch_key ?? "", title: event.title },
    branchInitials: branchInitials(branch, initials),
    google: g,
  });
  if (titleReview) console.warn("[google-sync] unsupported branch title edit", link.id, titleReview);
  // Google-owned fields only: event_members, weekdays and event type stay untouched
  const patch = seriesPatchFromGoogle({
    local: {
      title: event.title,
      memberCount: (event.event_members ?? []).length,
      branchKey: link.branch_key ?? "",
    },
    branchInitials: branchInitials(branch, initials),
    google: g,
    omitTimes: Boolean(timeReview),
    omitTitle: Boolean(titleReview),
  });
  await admin.from("events").update(patch).eq("id", link.event_id);

  // moved between the two connected calendars directly in Google
  if (link.calendar_source_id !== source.id) {
    await admin.from("events").update({ calendar_source_id: source.id }).eq("id", link.event_id);
  }

  // per-person weekday branches share one local rule: a Google recurrence edit
  // on a single branch is flagged for review instead of rewriting that rule
  const recurrenceReview = branchRecurrenceReview({
    local: {
      branchKey: link.branch_key ?? "",
      recurrence_rule: event.recurrence_rule,
      recurrence_until: event.recurrence_until ?? null,
    },
    google: g,
  });
  if (recurrenceReview) {
    console.warn("[google-sync] unsupported branch recurrence edit", link.id, recurrenceReview);
  }
  const review = [recurrenceReview, timeReview, titleReview].filter(Boolean).join(" ") || null;

  await admin
    .from("event_sync_links")
    .update({
      calendar_source_id: source.id,
      google_etag: g.etag ?? null,
      google_updated_at: g.updated ?? null,
      google_recurring_event_id: g.recurringEventId ?? null,
      last_source: "google",
      sync_error: review,
    })
    .eq("id", link.id);
}


/** The participation branch a link represents, used only for title formatting. */
function branchForLink(
  event: EventRow,
  link: LinkRow,
  _initials: Map<string, string>,
): SyncBranch {
  const participants = (event.event_members ?? []).map((m) => ({
    member_id: m.family_member_id,
    weekdays: m.weekdays,
  }));
  const branches = computeBranches({
    recurrence_rule: event.recurrence_rule,
    participants,
    member_ids: participants.map((p) => p.member_id),
  });
  return (
    branches.find((b) => b.key === link.branch_key) ?? {
      key: link.branch_key,
      weekdays: null,
      memberIds: participants.map((p) => p.member_id),
    }
  );
}

/**
 * One Google branch was deleted externally: drop the weekdays it covered from
 * the members that only attended on those days, leaving other branches intact.
 */
async function removeBranchParticipation(admin: Admin, link: LinkRow): Promise<void> {
  if (!link.branch_key) return;
  const removed = link.branch_key.split(",") as WeekdayCode[];
  const { data: rows } = await admin
    .from("event_members")
    .select("family_member_id, weekdays")
    .eq("event_id", link.event_id);
  for (const row of (rows ?? []) as { family_member_id: string; weekdays: string[] | null }[]) {
    if (!row.weekdays) continue;
    const next = row.weekdays.filter((d) => !removed.includes(d as WeekdayCode));
    if (next.length === row.weekdays.length) continue;
    if (next.length === 0) {
      await admin
        .from("event_members")
        .delete()
        .eq("event_id", link.event_id)
        .eq("family_member_id", row.family_member_id);
    } else {
      await admin
        .from("event_members")
        .update({ weekdays: next })
        .eq("event_id", link.event_id)
        .eq("family_member_id", row.family_member_id);
    }
  }
}


/**
 * The link of a detached exception, found by its durable occurrence identity
 * (household + calendar + recurring series + original start) rather than by the
 * transient Google instance id.
 */
async function findExceptionLinkByOccurrence(
  admin: Admin,
  familyId: string,
  sourceId: string,
  g: GoogleEvent,
): Promise<LinkRow | null> {
  const originalStart = originalStartKey(g.originalStartTime);
  if (!g.recurringEventId || !originalStart) return null;
  const { data } = await admin
    .from("event_sync_links")
    .select("*")
    .eq("family_id", familyId)
    .eq("google_recurring_event_id", g.recurringEventId)
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as LinkRow[];
  const matches = rows.filter(
    (l) => isExceptionLink(l) && sameOriginalStart(l.google_original_start ?? null, originalStart),
  );
  return (
    matches.find((l) => l.calendar_source_id === sourceId) ?? matches[0] ?? null
  );
}

/**
 * Whether the detached occurrence a link points at still exists in Google.
 *
 * Unknown on any lookup failure on purpose: keeping a local exception is always
 * safer than deleting an occurrence a household actually moved.
 */
async function detachedOccurrenceState(
  conn: ConnectionContext,
  source: SourceRow,
  link: LinkRow,
): Promise<{ status: "live" | "gone" | "unknown"; event?: GoogleEvent }> {
  if (!source.external_calendar_id || link.calendar_source_id !== source.id) {
    return { status: "unknown" };
  }
  try {
    const direct = await google.getEventState(
      conn.connectionKey,
      source.external_calendar_id,
      link.google_event_id,
    );
    if (direct === "live") return { status: "live" };
    const occurrence = await google.findLiveOccurrence(
      conn.connectionKey,
      source.external_calendar_id,
      link.google_recurring_event_id!,
      link.google_original_start!,
    );
    return occurrence ? { status: "live", event: occurrence } : { status: "gone" };
  } catch (error) {
    if (error instanceof GoogleAuthError) throw error;
    console.error("[google-sync] occurrence verification failed", link.id, error);
    return { status: "unknown" };
  }
}

/** Re-points a detached exception at the instance id Google now uses. */
async function adoptOccurrenceIdentity(
  admin: Admin,
  link: LinkRow,
  g: GoogleEvent,
): Promise<void> {
  await admin
    .from("event_sync_links")
    .update({ google_event_id: g.id, google_etag: g.etag ?? null, google_updated_at: g.updated ?? null })
    .eq("id", link.id);
  await admin.from("events").update({ external_event_id: g.id }).eq("id", link.event_id);
}

/**
 * Finds the local detached exception that already represents this exact Google
 * instance, using the strongest identity available and never widening beyond
 * the household. Read-only: it only decides whether a new row is needed.
 */
async function findDetachedException(
  admin: Admin,
  familyId: string,
  sourceId: string,
  g: GoogleEvent,
): Promise<string | null> {
  // 1. an existing link row for this exact Google instance
  const { data: linkRows } = await admin
    .from("event_sync_links")
    .select("event_id")
    .eq("family_id", familyId)
    .eq("google_event_id", g.id)
    .order("created_at", { ascending: true })
    .limit(1);
  const linked = (linkRows ?? [])[0]?.event_id as string | undefined;
  if (linked) return linked;

  // 1b. the durable occurrence identity: recurring series + original start.
  // Google's instance id is transient, so this is what survives a re-key.
  const byOccurrence = await findExceptionLinkByOccurrence(admin, familyId, sourceId, g);
  if (byOccurrence) return byOccurrence.event_id;

  // 2. a local event already stamped with this Google instance id
  const { data: byInstance } = await admin
    .from("events")
    .select("id")
    .eq("family_id", familyId)
    .eq("external_event_id", g.id)
    .order("created_at", { ascending: true })
    .limit(1);
  const stamped = (byInstance ?? [])[0]?.id as string | undefined;
  if (stamped) return stamped;

  // 3. an orphan one-off of the same Google series on the same occurrence day
  const day = dayOf(g.originalStartTime?.date ?? g.originalStartTime?.dateTime);
  if (!g.recurringEventId || !day) return null;
  const { data: orphans } = await admin
    .from("events")
    .select("id, start_at")
    .eq("family_id", familyId)
    .eq("external_recurring_event_id", g.recurringEventId)
    .is("recurrence_rule", null)
    .order("created_at", { ascending: true });
  for (const row of (orphans ?? []) as { id: string; start_at: string }[]) {
    if (dayOf(row.start_at) === day) return row.id;
  }
  return null;
}



/**
 * Creates the detached local event for a Google-edited single occurrence of an
 * app-created series.
 *
 * Unlike `createLocalEvent`, this inherits everything the app owns from the
 * parent branch (event type and family assignments) and strips the generated
 * member suffix from the Google title, so an external instance edit never
 * degrades into an unassigned import.
 */
async function createExceptionEvent(
  admin: Admin,
  source: SourceRow,
  g: GoogleEvent,
  initials: Map<string, string>,
  parentEventId: string,
  branchKey: string,
): Promise<string | null> {
  const { data: parent } = await admin
    .from("events")
    .select("*, event_members(family_member_id, weekdays)")
    .eq("id", parentEventId)
    .maybeSingle();
  if (!parent) return null;

  const parentRow = parent as EventRow;
  const branch = branchForLink(
    parentRow,
    { branch_key: branchKey } as LinkRow,
    initials,
  );
  const fields = exceptionEventFields({
    parent: { title: parentRow.title, event_type: parentRow.event_type },
    branch,
    branchInitials: branchInitials(branch, initials),
    google: g,
  });

  const { data, error } = await admin
    .from("events")
    .insert({
      family_id: source.family_id,
      calendar_source_id: source.id,
      title: fields.title,
      start_at: fields.start_at,
      end_at: fields.end_at,
      all_day: fields.all_day,
      location: g.location ?? parentRow.location ?? null,
      notes: g.description ?? parentRow.notes ?? null,
      event_type: fields.event_type,
      recurrence_rule: null,
      recurrence_until: null,
      excluded_dates: [],
      external_event_id: g.id,
      external_recurring_event_id: g.recurringEventId ?? null,
      needs_family_assignment: fields.needs_family_assignment,
      last_change_source: "google",
    })
    .select("id")
    .single();
  if (error) throw error;

  const eventId = data.id as string;
  if (fields.member_ids.length > 0) {
    await admin.from("event_members").insert(
      fields.member_ids.map((id: string) => ({
        event_id: eventId,
        family_member_id: id,
        weekdays: null,
      })),
    );
  }
  return eventId;
}


/**
 * Creates the local event for something that was made in Google.
 *
 * Family assignment is deliberately left empty and flagged so an Owner can
 * assign members in the app; nothing is guessed from the Google title.
 */
async function createLocalEvent(
  admin: Admin,
  source: SourceRow,
  g: GoogleEvent,
  _initials: Map<string, string>,
  detachedFrom: string | null,
): Promise<string> {
  const times = fromGoogleTimes(g);
  const rec = detachedFrom
    ? { rule: null, weekdays: null, until: null, excludedDates: [] }
    : fromGoogleRecurrence(g.recurrence);
  const { data, error } = await admin
    .from("events")
    .insert({
      family_id: source.family_id,
      calendar_source_id: source.id,
      title: (g.summary ?? "Untitled event").trim() || "Untitled event",
      start_at: times.start_at,
      end_at: times.end_at,
      all_day: times.all_day,
      location: g.location ?? null,
      notes: g.description ?? null,
      event_type: "other",
      recurrence_rule: localRuleFromGoogle(rec),
      recurrence_until: rec.until,
      excluded_dates: rec.excludedDates,
      external_event_id: g.id,
      external_recurring_event_id: g.recurringEventId ?? null,
      needs_family_assignment: true,
      last_change_source: "google",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Pulls changes for one connected calendar, incrementally when possible. */
export async function pullSource(
  admin: Admin,
  conn: ConnectionContext,
  source: SourceRow,
  initial = false,
): Promise<{ applied: number; ok: boolean }> {
  const now = new Date().toISOString();
  try {
    // The stable calendarId is the identity: a rename in Google just refreshes
    // the local label, it never creates a new connection.
    const remote = await google.getCalendar(conn.connectionKey, source.external_calendar_id!);
    const renamed = calendarNameChange(source.name, remote.summary);
    // Timezone housekeeping happens here so users never have to touch Google's
    // own calendar settings after connecting.
    const googleTimeZone = await reconcileSourceTimeZone(admin, conn, source, remote);

    const initials = await initialsFor(admin, source.family_id);
    const window = syncWindow(new Date(), initial);
    let res = await google.listEvents(conn.connectionKey, source.external_calendar_id!, {
      syncToken: initial ? null : source.google_sync_token,
      ...window,
    });
    if (res.invalidSyncToken) {
      res = await google.listEvents(conn.connectionKey, source.external_calendar_id!, window);
    }

    for (const item of res.items) {
      await applyGoogleEvent(admin, conn, source, item, initials);
    }

    await admin
      .from("calendar_sources")
      .update({
        google_sync_token: res.nextSyncToken ?? source.google_sync_token,
        last_synced_at: now,
        ...(renamed ? { name: renamed } : {}),
        ...(googleTimeZone ? { google_time_zone: googleTimeZone } : {}),
        ...sourceSyncPatch({ outcome: "ok", failureCount: 0, now }),
      })
      .eq("id", source.id);

    return { applied: res.items.length, ok: true };
  } catch (error) {
    if (error instanceof GoogleAuthError) throw error;
    const unavailable = error instanceof google.GoogleCalendarUnavailableError;
    const reason = unavailable
      ? "The Google calendar connected to this family can no longer be found."
      : error instanceof Error
        ? error.message
        : "Temporary sync failure";
    // Pause, never mutate: local events keep their Google linkage so sync can
    // resume unchanged if access comes back.
    await admin
      .from("calendar_sources")
      .update(
        sourceSyncPatch({
          outcome: unavailable ? "unavailable" : "transient",
          reason,
          failureCount: source.sync_failure_count ?? 0,
          now,
        }),
      )
      .eq("id", source.id);
    console.error(
      unavailable ? "[google-sync] calendar unavailable, sync paused" : "[google-sync] transient failure",
      source.id,
      reason,
    );
    return { applied: 0, ok: false };
  }
}

/** Pull every connected calendar for a household. */
export async function pullHousehold(
  admin: Admin,
  familyId: string,
  initial = false,
): Promise<{ applied?: number; skipped?: string }> {
  const result = await guard(admin, familyId, async () => {
    const conn = await getConnection(admin, familyId);
    if (!conn) return { skipped: "not_connected" };
    const sources = await googleSources(admin, familyId);
    let applied = 0;
    for (const source of sources) {
      applied += (await pullSource(admin, conn, source, initial)).applied;
    }
    await touchSynced(admin, familyId);
    return { applied };
  });
  return result as { applied?: number; skipped?: string };
}

/**
 * Pull a chosen subset of a household's connected calendars.
 *
 * Same pipeline (and therefore the same duplicate protection) as
 * `pullHousehold`; the only difference is that callers who care about a few
 * calendars — the pre-send refresh for emailed summaries, for instance — do not
 * have to touch the rest of the household. `sourceIds = null` means all.
 */
export async function pullSelectedSources(
  admin: Admin,
  familyId: string,
  sourceIds: string[] | null,
): Promise<{ applied?: number; attempted?: number; failed?: number; skipped?: string }> {
  const result = await guard(admin, familyId, async () => {
    const conn = await getConnection(admin, familyId);
    if (!conn) return { skipped: "not_connected" };
    const all = await googleSources(admin, familyId);
    const wanted = sourceIds ? all.filter((s) => sourceIds.includes(s.id)) : all;
    if (wanted.length === 0) return { skipped: "no_google_calendar" };
    let applied = 0;
    let failed = 0;
    for (const source of wanted) {
      const outcome = await pullSource(admin, conn, source, false);
      applied += outcome.applied;
      if (!outcome.ok) failed += 1;
    }
    await touchSynced(admin, familyId);
    return { applied, attempted: wanted.length, failed };
  });
  return result as { applied?: number; attempted?: number; failed?: number; skipped?: string };
}

/* --------------------------------------------------------------- reconcile */

/**
 * Safety net for missed push notifications: re-reads the sync window, repairs
 * app events that never reached Google, and refreshes expiring push channels.
 * Uses the same link table as live sync, so it cannot create duplicates.
 */
export async function reconcileHousehold(
  admin: Admin,
  familyId: string,
): Promise<{ applied?: number; repaired?: number; skipped?: string }> {
  const result = await guard(admin, familyId, async () => {
    const conn = await getConnection(admin, familyId);
    if (!conn) return { skipped: "not_connected" };
    const sources = await googleSources(admin, familyId);
    if (sources.length === 0) return { skipped: "no_google_calendar" };

    let applied = 0;
    for (const source of sources) {
      applied += (await pullSource(admin, conn, source, false)).applied;
    }

    // app events inside the forward window whose Google counterpart is missing.
    // A link row alone is not proof of a working sync: it can point at a
    // calendar that is no longer eligible, or at a Google event that was deleted.
    const { timeMin, timeMax } = syncWindow(new Date(), false);
    const { data: candidates } = await admin
      .from("events")
      .select("id, start_at, recurrence_rule, all_day")
      .eq("family_id", familyId)
      .lte("start_at", timeMax);
    const { data: linked } = await admin
      .from("event_sync_links")
      .select("event_id")
      .eq("family_id", familyId);
    const linkedIds = new Set((linked ?? []).map((l: { event_id: string }) => l.event_id));

    let repaired = 0;
    for (const candidate of (candidates ?? []) as {
      id: string;
      start_at: string;
      recurrence_rule: string | null;
      all_day: boolean;
    }[]) {
      if (!candidate.recurrence_rule && candidate.start_at < timeMin) continue;
      if (linkedIds.has(candidate.id)) {
        const { pruned } = await pruneStaleLinks(
          admin,
          conn,
          familyId,
          sources,
          candidate.id,
        );
        // nothing stale: every branch still points at a live Google event.
        // Two exceptions: recurring timed series written before the DST fix still
        // carry UTC recurrence metadata, and a live link can belong to an
        // obsolete branch representation after a shared <-> per-person switch.
        if (
          pruned === 0 &&
          !(await hasObsoleteBranchLinks(admin, familyId, candidate.id)) &&
          !(await hasMissingBranchLinks(admin, familyId, candidate.id)) &&
          !(await needsBodyRepatch(admin, familyId, candidate, candidate.id))
        ) {
          // A stale live master is repaired in place: the already-generated body
          // is PATCHed onto the same Google master, keeping local event, link and
          // Google ids. A healthy master classifies clean and is not written to.
          const dst = await repairStaleRecurringBodies(
            admin,
            conn,
            familyId,
            sources,
            candidate.id,
          );
          if (dst.repaired > 0) repaired += dst.repaired;
          continue;
        }
      }

      await pushEvent(admin, familyId, candidate.id);
      repaired += 1;
    }


    await ensureWatchChannels(admin, conn, sources);
    await touchSynced(admin, familyId);
    return { applied, repaired };
  });
  return result as { applied?: number; repaired?: number; skipped?: string };
}

/**
 * Runs an already-accepted manual sync and durably releases its lock. The
 * reconciliation itself is intentionally unchanged.
 */
export async function runAcceptedManualSync(
  admin: Admin,
  familyId: string,
  attemptId: string,
  initial = false,
): Promise<void> {
  let failure: string | null = null;
  try {
    const result = initial
      ? await pullHousehold(admin, familyId, true)
      : await reconcileHousehold(admin, familyId);
    if (result.skipped) {
      failure =
        result.skipped === "google_disconnected" || result.skipped === "not_connected"
          ? "Reconnect Google Calendar to resume syncing."
          : "Google Calendar sync couldn’t finish. Try again.";
    }
  } catch (error) {
    console.error("[google-sync] background manual sync failed", error);
    failure = "Google Calendar sync couldn’t finish. Try again.";
  }

  const { error } = await admin
    .from("google_connections")
    .update({
      manual_sync_started_at: null,
      manual_sync_error: failure,
    })
    .eq("family_id", familyId)
    .eq("manual_sync_attempt_id", attemptId);
  if (error) console.error("[google-sync] could not release manual sync lock", error);
}

/* ------------------------------------------------------------ push channels */

export function webhookAddress(origin: string): string {
  return new URL("/api/public/google-calendar/notify", origin).toString();
}

/** (Re)registers Google push channels when missing or close to expiry. */
export async function ensureWatchChannels(
  admin: Admin,
  conn: ConnectionContext,
  sources: SourceRow[],
): Promise<void> {
  const origin = process.env["PUBLIC_APP_ORIGIN"];
  const token = process.env["LOVABLE_CRON_SECRET"];
  if (!origin || !token) return; // no public origin configured: reconciliation still covers us

  for (const source of sources) {
    const { data } = await admin
      .from("calendar_sources")
      .select("google_channel_id, google_channel_expires_at")
      .eq("id", source.id)
      .maybeSingle();
    const expires = data?.google_channel_expires_at
      ? Date.parse(data.google_channel_expires_at)
      : 0;
    if (data?.google_channel_id && expires > Date.now() + 24 * 60 * 60 * 1000) continue;

    try {
      const channelId = `ofc-${source.id}-${Date.now()}`;
      const watch = await google.watchCalendar(
        conn.connectionKey,
        source.external_calendar_id!,
        channelId,
        webhookAddress(origin),
        token,
      );
      await admin
        .from("calendar_sources")
        .update({
          google_channel_id: watch.id,
          google_channel_resource_id: watch.resourceId,
          google_channel_expires_at: watch.expiration
            ? new Date(Number(watch.expiration)).toISOString()
            : null,
        })
        .eq("id", source.id);
    } catch (error) {
      console.error("[google-sync] watch registration failed", error);
    }
  }
}

/** Resolves the household that owns a Google push channel id. */
export async function familyForChannel(
  admin: Admin,
  channelId: string,
): Promise<{ familyId: string } | null> {
  const { data } = await admin
    .from("calendar_sources")
    .select("family_id")
    .eq("google_channel_id", channelId)
    .maybeSingle();
  return data ? { familyId: data.family_id } : null;
}

/* ------------------------------------------------- one-time recurrence repair */

/**
 * One-time repair for Google-originated recurring series that were imported
 * before the recurrence fix and lost their `BYDAY` weekdays.
 *
 * Safe by construction:
 *  - only touches events that have Google sync links (never local-only events);
 *  - all links of an event must resolve to the SAME Google recurring master;
 *    conflicting masters (per-person weekday branches) are skipped, never guessed;
 *  - the authoritative recurrence comes from Google, never guessed from local
 *    dates, and is mapped by the same `fromGoogleRecurrence` /
 *    `localRuleFromGoogle` helpers that live sync uses;
 *  - idempotent: a row whose rule already matches Google is left alone.
 */
export interface RecurrenceRepairSummary {
  examined?: number;
  repaired?: number;
  unchanged?: number;
  skipped?: number;
  errored?: number;
  details?: string[];
  skippedReason?: string;
}

export async function repairGoogleRecurrenceRules(
  admin: Admin,
  familyId: string,
  eventIds: string[] | null = null,
): Promise<RecurrenceRepairSummary> {
  const result = await guard(admin, familyId, async () => {
    const conn = await getConnection(admin, familyId);
    if (!conn) return { skippedReason: "not_connected" };
    const sources = await googleSources(admin, familyId);
    if (sources.length === 0) return { skippedReason: "no_google_calendar" };

    let query = admin
      .from("events")
      .select("id, title, recurrence_rule, recurrence_until, excluded_dates")
      .eq("family_id", familyId)
      .not("recurrence_rule", "is", null);
    if (eventIds && eventIds.length > 0) query = query.in("id", eventIds);
    const events = ((await query).data ?? []) as {
      id: string;
      title: string;
      recurrence_rule: string | null;
    }[];

    let examined = 0;
    let repaired = 0;
    let unchanged = 0;
    let skipped = 0;
    let errored = 0;
    const details: string[] = [];

    const skip = (eventId: string, reason: string) => {
      skipped += 1;
      details.push(`skipped ${eventId}: ${reason}`);
      console.warn("[google-sync] recurrence repair skipped", eventId, reason);
    };

    for (const event of events) {
      examined += 1;
      const { data: linkRows } = await admin
        .from("event_sync_links")
        .select("calendar_source_id, google_event_id, google_recurring_event_id, branch_key")
        .eq("family_id", familyId)
        .eq("event_id", event.id);
      const links = (linkRows ?? []) as {
        calendar_source_id: string;
        google_event_id: string;
        google_recurring_event_id: string | null;
        branch_key: string;
      }[];
      if (links.length === 0) {
        skip(event.id, "no_google_links");
        continue;
      }

      // only links pointing at a currently active/eligible Google calendar
      const usable = links
        .map((l) => ({ link: l, source: sources.find((s) => s.id === l.calendar_source_id) }))
        .filter((x) => Boolean(x.source?.external_calendar_id));
      if (usable.length === 0) {
        skip(event.id, "no_active_google_calendar_for_links");
        continue;
      }

      // every usable link must agree on one Google recurring master
      const masters = new Set(
        usable.map((x) => x.link.google_recurring_event_id ?? x.link.google_event_id),
      );
      if (masters.size !== 1) {
        skip(event.id, `ambiguous_google_masters(${masters.size})`);
        continue;
      }
      const chosen = usable[0]!;
      const masterId = [...masters][0]!;

      try {
        const master = await google.getEvent(
          conn.connectionKey,
          chosen.source!.external_calendar_id!,
          masterId,
        );
        if (!master.recurrence || master.recurrence.length === 0) {
          skip(event.id, "google_master_not_recurring");
          continue;
        }
        const rec = fromGoogleRecurrence(master.recurrence);
        const rule = localRuleFromGoogle(rec);
        if (!rule) {
          skip(event.id, "unmappable_google_recurrence");
          continue;
        }
        if (rule === event.recurrence_rule) {
          unchanged += 1;
          continue;
        }
        const { error } = await admin
          .from("events")
          .update({ recurrence_rule: rule, last_change_source: "google" })
          .eq("id", event.id)
          .eq("family_id", familyId);
        if (error) throw error;
        repaired += 1;
        details.push(`${event.title}: ${event.recurrence_rule} -> ${rule}`);
      } catch (error) {
        if (error instanceof GoogleAuthError) throw error;
        errored += 1;
        details.push(
          `errored ${event.id}: ${error instanceof Error ? error.message : "unknown_error"}`,
        );
        console.error("[google-sync] recurrence repair failed", event.id, error);
      }
    }

    return { examined, repaired, unchanged, skipped, errored, details };
  });
  if (result && typeof (result as { skipped?: unknown }).skipped === "string") {
    return { skippedReason: (result as { skipped: string }).skipped };
  }
  return result as RecurrenceRepairSummary;
}


/* ------------------------------------------------- read-only DST diagnostic */

export interface DstRepairDiagnostic {
  google_master_id: string;
  local_event_id: string | null;
  link_id: string | null;
  branch_key: string | null;
  calendar_source_id: string | null;
  calendar_name: string | null;
  time_zone: string | null;
  /** Dry-run classification of the existing repair path. */
  classification: "HEALTHY" | "STALE" | "SKIPPED";
  reason: string;
  probe_date: string | null;
  actual_instance_start: string | null;
  actual_instance_end: string | null;
  actual_master_start: string | null;
  actual_master_start_time_zone: string | null;
  actual_master_end: string | null;
  actual_master_end_time_zone: string | null;
  actual_master_recurrence: string[] | null;
  expected_start_wall_clock: string | null;
  expected_end_wall_clock: string | null;
  expected_time_zone: string | null;
  /** Diagnostics never write: always false / "none". */
  repair_write_attempted: false;
  google_write_method: "none";
  /** Exactly what a repair would PATCH onto the same Google master. */
  outbound: {
    start_dateTime: string | null;
    start_timeZone: string | null;
    end_dateTime: string | null;
    end_timeZone: string | null;
    recurrence: string[] | null;
  } | null;
  /** No Google write happens here, so no fresh response exists. */
  google_response: { success: null; error: null; updated: null; etag: null };
  /** Bookkeeping left by the most recent real reconcile/repair attempt. */
  last_attempt: {
    link_last_source: string | null;
    link_last_pushed_at: string | null;
    link_google_updated_at: string | null;
    link_google_etag: string | null;
    link_app_version: number | null;
    link_sync_error: string | null;
    /** Result of the most recent real DST repair write, when one happened. */
    dst_repair: {
      attempted?: boolean;
      method?: string;
      success?: boolean;
      error?: string | null;
      updated?: string | null;
      etag?: string | null;
      reason?: string;
      at?: string;
    } | null;
  } | null;
}

function blankResponse(): DstRepairDiagnostic["google_response"] {
  return { success: null, error: null, updated: null, etag: null };
}

/**
 * Read-only classification of what `hasStaleRemoteRecurringBody()` /
 * reconcile would decide for ONE linked recurring Google master, plus the exact
 * outbound body a repair would PATCH. It reuses the same `branchBody()` and the
 * same staleness helpers as the live repair path and never writes to Google or
 * to the database.
 */
export async function diagnoseDstRepair(
  admin: Admin,
  familyId: string,
  googleMasterId: string,
): Promise<DstRepairDiagnostic> {
  const base: DstRepairDiagnostic = {
    google_master_id: googleMasterId,
    local_event_id: null,
    link_id: null,
    branch_key: null,
    calendar_source_id: null,
    calendar_name: null,
    time_zone: null,
    classification: "SKIPPED",
    reason: "no_link_for_master",
    probe_date: null,
    actual_instance_start: null,
    actual_instance_end: null,
    actual_master_start: null,
    actual_master_start_time_zone: null,
    actual_master_end: null,
    actual_master_end_time_zone: null,
    actual_master_recurrence: null,
    expected_start_wall_clock: null,
    expected_end_wall_clock: null,
    expected_time_zone: null,
    repair_write_attempted: false,
    google_write_method: "none",
    outbound: null,
    google_response: blankResponse(),
    last_attempt: null,
  };

  const { data: linkRows } = await admin
    .from("event_sync_links")
    .select(
      "id, event_id, calendar_source_id, google_event_id, google_recurring_event_id, google_original_start, branch_key, google_etag, google_updated_at, last_source, last_pushed_at, app_version, sync_error, dst_repair",
    )
    .eq("family_id", familyId)
    .eq("google_event_id", googleMasterId);
  const links = (linkRows ?? []) as (LinkRow & {
    app_version: number | null;
    sync_error: string | null;
    dst_repair: NonNullable<DstRepairDiagnostic["last_attempt"]>["dst_repair"];
  })[];
  const link = links[0];
  if (!link) return base;

  base.link_id = link.id;
  base.local_event_id = link.event_id;
  base.branch_key = link.branch_key;
  base.calendar_source_id = link.calendar_source_id;
  base.last_attempt = {
    link_last_source: link.last_source ?? null,
    link_last_pushed_at: link.last_pushed_at ?? null,
    link_google_updated_at: link.google_updated_at ?? null,
    link_google_etag: link.google_etag ?? null,
    link_app_version: link.app_version ?? null,
    link_sync_error: link.sync_error ?? null,
    dst_repair: link.dst_repair ?? null,
  };

  if (isExceptionLink(link)) {
    return { ...base, reason: "detached_exception_link_not_dst_repairable" };
  }

  const conn = await getConnection(admin, familyId);
  if (!conn) return { ...base, reason: "not_connected" };
  const sources = await googleSources(admin, familyId);
  const source = sources.find((s) => s.id === link.calendar_source_id);
  if (!source?.external_calendar_id) return { ...base, reason: "no_active_google_calendar" };
  base.calendar_name = source.name;

  const event = await loadEvent(admin, link.event_id);
  if (!event) return { ...base, reason: "local_event_missing" };
  if (event.all_day) return { ...base, reason: "all_day_event_not_dst_repairable" };
  if (!event.recurrence_rule) return { ...base, reason: "not_recurring" };

  const participants = (event.event_members ?? []).map((m) => ({
    member_id: m.family_member_id,
    weekdays: m.weekdays,
  }));
  const branches = computeBranches({
    recurrence_rule: event.recurrence_rule,
    participants,
    member_ids: participants.map((p) => p.member_id),
  });
  const branch = branches.find((b) => b.key === link.branch_key);
  if (!branch) return { ...base, reason: `no_desired_branch_for_key("${link.branch_key}")` };

  const timeZone = await householdTimeZone(admin, familyId);
  base.time_zone = timeZone;
  const initials = await initialsFor(admin, familyId);
  const expected = branchBody(event, branch, initials, timeZone) as {
    start?: GoogleDateTime;
    end?: GoogleDateTime;
    recurrence?: string[] | null;
  };
  base.expected_start_wall_clock = expected.start?.dateTime ?? null;
  base.expected_end_wall_clock = expected.end?.dateTime ?? null;
  base.expected_time_zone = expected.start?.timeZone ?? timeZone;
  base.outbound = {
    start_dateTime: expected.start?.dateTime ?? null,
    start_timeZone: expected.start?.timeZone ?? null,
    end_dateTime: expected.end?.dateTime ?? null,
    end_timeZone: expected.end?.timeZone ?? null,
    recurrence: expected.recurrence ?? null,
  };

  let remote: GoogleEvent;
  try {
    remote = await google.getEvent(
      conn.connectionKey,
      source.external_calendar_id,
      link.google_event_id,
    );
  } catch (error) {
    return {
      ...base,
      reason: `google_master_unreadable: ${error instanceof Error ? error.message : "unknown_error"}`,
    };
  }
  base.actual_master_start = remote.start?.dateTime ?? remote.start?.date ?? null;
  base.actual_master_start_time_zone = remote.start?.timeZone ?? null;
  base.actual_master_end = remote.end?.dateTime ?? remote.end?.date ?? null;
  base.actual_master_end_time_zone = remote.end?.timeZone ?? null;
  base.actual_master_recurrence = remote.recurrence ?? null;

  if (remoteRecurringBodyIsStale(expected, remote)) {
    return {
      ...base,
      classification: "STALE",
      reason: "master_body_differs_from_expected(start/end/timeZone/recurrence)",
    };
  }

  if (!remoteRecurringTimesAreAmbiguous(remote)) {
    return {
      ...base,
      classification: "HEALTHY",
      reason: "master_body_matches_expected_floating_wall_clock_and_iana_zone",
    };
  }

  // ambiguous body: the truth is one expanded occurrence, read read-only
  const probeMin = new Date(Date.now()).toISOString();
  const probeMax = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const instances = await google.listInstances(
      conn.connectionKey,
      source.external_calendar_id,
      link.google_event_id,
      probeMin,
      probeMax,
    );
    for (const instance of instances) {
      if (instance.status === "cancelled") continue;
      const start = instance.start?.dateTime ?? instance.start?.date ?? null;
      const drifted = occurrenceWallClockDrifted(
        expected.start?.dateTime,
        instance.start,
        timeZone,
      );
      if (drifted) {
        return {
          ...base,
          classification: "STALE",
          reason: "expanded_occurrence_local_wall_clock_drifted",
          probe_date: start ? start.slice(0, 10) : null,
          actual_instance_start: start,
          actual_instance_end: instance.end?.dateTime ?? instance.end?.date ?? null,
        };
      }
      base.probe_date = start ? start.slice(0, 10) : base.probe_date;
      base.actual_instance_start = start;
      base.actual_instance_end = instance.end?.dateTime ?? instance.end?.date ?? null;
    }
  } catch (error) {
    return {
      ...base,
      reason: `instance_probe_failed: ${error instanceof Error ? error.message : "unknown_error"}`,
    };
  }

  return {
    ...base,
    classification: "HEALTHY",
    reason: "ambiguous_master_body_but_expanded_occurrences_keep_expected_wall_clock",
  };
}
