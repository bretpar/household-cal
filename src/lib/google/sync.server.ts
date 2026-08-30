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
  branchRecurrenceReview,
  calendarNameChange,
  cancellationAction,
  computeBranches,
  exceptionEventFields,
  fromGoogleRecurrence,
  fromGoogleTimes,

  googleTitle,
  seriesPatchFromGoogle,
  sourceSyncPatch,
  shouldApplyGoogleChange,
  stripGeneratedSuffix,
  syncWindow,
  toGoogleRecurrence,
  toGoogleTimes,
  type GoogleEvent,
  type SyncBranch,
} from "@/lib/google/mapping";
import { decryptConnectionKey } from "@/lib/google/crypto.server";
import * as google from "@/lib/google/api.server";
import { GoogleAuthError } from "@/lib/google/api.server";
import type { WeekdayCode } from "@/lib/family-data";

type Admin = { from: (table: string) => any };

const FALLBACK_TIME_ZONE = "America/Los_Angeles";

/** Household IANA timezone: recurring Google series are anchored to local time. */
async function householdTimeZone(admin: Admin, familyId: string): Promise<string> {
  const { data } = await admin
    .from("families")
    .select("timezone")
    .eq("id", familyId)
    .maybeSingle();
  const tz = (data?.timezone as string | null) || FALLBACK_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}


export interface ConnectionContext {
  connectionId: string;
  familyId: string;
  connectionKey: string;
  accountEmail: string;
}

interface SourceRow {
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
  event_members?: { family_member_id: string; weekdays: WeekdayCode[] | null }[];
}

interface LinkRow {
  id: string;
  event_id: string;
  calendar_source_id: string;
  google_event_id: string;
  google_recurring_event_id: string | null;
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
      "id, family_id, name, external_calendar_id, is_main, google_sync_token, google_channel_id, google_channel_resource_id, sync_status, sync_failure_count",
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
    .select("id, calendar_source_id, google_event_id")
    .eq("family_id", familyId)
    .eq("event_id", eventId);
  const links = (data ?? []) as {
    id: string;
    calendar_source_id: string;
    google_event_id: string;
  }[];
  let remaining = 0;
  let pruned = 0;
  for (const link of links) {
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

async function initialsFor(admin: Admin, familyId: string): Promise<Map<string, string>> {
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
  const anchored = branchAnchoredTimes(event.start_at, event.end_at, branch.weekdays);
  const times = toGoogleTimes(anchored.startAt, anchored.endAt, event.all_day, timeZone);

  const recurrence = toGoogleRecurrence(
    event.recurrence_rule,
    branch.weekdays,
    event.recurrence_until,
    event.excluded_dates ?? [],
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
    const links = (linkRows ?? []) as LinkRow[];

    const timeZone = await householdTimeZone(admin, familyId);
    let pushed = 0;
    for (const branch of branches) {
      const body = branchBody(event, branch, initials, timeZone);

      const link = links.find((l) => l.branch_key === branch.key);
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

      await admin.from("event_sync_links").upsert(
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
      pushed += 1;
    }

    // branches that no longer exist (e.g. a member's days changed) are removed
    const keep = new Set(branches.map((b) => b.key));
    for (const stale of links.filter((l) => !keep.has(l.branch_key))) {
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
async function applyGoogleEvent(
  admin: Admin,
  conn: ConnectionContext,
  source: SourceRow,
  g: GoogleEvent,
  initials: Map<string, string>,
): Promise<void> {
  const familyId = source.family_id;
  const { data: linkRow } = await admin
    .from("event_sync_links")
    .select("*")
    .eq("google_event_id", g.id)
    .eq("family_id", familyId)
    .maybeSingle();
  let link = (linkRow as LinkRow | null) ?? null;

  /* ---------- cancellations ---------- */
  if (g.status === "cancelled") {
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
    // cancelled single occurrence of a series we know about
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
      const detached = await createExceptionEvent(
        admin,
        source,
        g,
        initials,
        seriesLink.event_id,
        seriesLink.branch_key ?? "",
      );
      if (!detached) return;
      await admin.from("event_sync_links").insert({
        family_id: familyId,
        event_id: detached,
        calendar_source_id: source.id,
        google_event_id: g.id,
        google_recurring_event_id: g.recurringEventId,
        branch_key: "",
        google_etag: g.etag ?? null,
        google_updated_at: g.updated ?? null,
        last_source: "google",
      });
      return;
    }
  }



  /* ---------- brand new Google event ---------- */
  if (!link) {
    const newId = await createLocalEvent(admin, source, g, initials, null);
    await admin.from("event_sync_links").insert({
      family_id: familyId,
      event_id: newId,
      calendar_source_id: source.id,
      google_event_id: g.id,
      google_recurring_event_id: g.recurringEventId ?? null,
      branch_key: "",
      google_etag: g.etag ?? null,
      google_updated_at: g.updated ?? null,
      last_source: "google",
    });
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
  // Google-owned fields only: event_members, weekdays and event type stay untouched
  const patch = seriesPatchFromGoogle({
    local: {
      title: event.title,
      memberCount: (event.event_members ?? []).length,
      branchKey: link.branch_key ?? "",
    },
    branchInitials: branchInitials(branch, initials),
    google: g,
  });
  await admin.from("events").update(patch).eq("id", link.event_id);

  // moved between the two connected calendars directly in Google
  if (link.calendar_source_id !== source.id) {
    await admin.from("events").update({ calendar_source_id: source.id }).eq("id", link.event_id);
  }

  // per-person weekday branches share one local rule: a Google recurrence edit
  // on a single branch is flagged for review instead of rewriting that rule
  const review = branchRecurrenceReview({
    local: {
      branchKey: link.branch_key ?? "",
      recurrence_rule: event.recurrence_rule,
      recurrence_until: event.recurrence_until ?? null,
    },
    google: g,
  });
  if (review) console.warn("[google-sync] unsupported branch recurrence edit", link.id, review);

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
  const rec = detachedFrom ? { rule: null, until: null, excludedDates: [] } : fromGoogleRecurrence(g.recurrence);
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
      recurrence_rule: rec.rule,
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
        // One exception: recurring timed series written before the DST fix still
        // carry UTC recurrence metadata, so patch those in place exactly once.
        if (pruned === 0 && !(await needsBodyRepatch(admin, familyId, candidate, candidate.id)))
          continue;
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
