import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { BulkDeleteFilters, BulkDeleteTarget } from "@/lib/google/bulk-delete";

function validateBulkDeleteFilters(input: BulkDeleteFilters): BulkDeleteFilters {
  const sourceId = String(input?.source_id ?? "").trim();
  const title = String(input?.title ?? "").trim();
  const startDate = String(input?.start_date ?? "").trim();
  // A null/blank end date means "all future matching events".
  const endDate = input?.end_date ? String(input.end_date).trim() : null;
  const startTime = input?.start_time ? String(input.start_time).trim() : null;
  const endTime = input?.end_time ? String(input.end_time).trim() : null;
  if (!sourceId) throw new Error("Choose a calendar");
  if (!title) throw new Error("Enter an exact event title");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error("Choose a valid start date");
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error("Choose a valid end date");
  if (endDate && startDate > endDate) throw new Error("Start date must be on or before end date");
  if (startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) throw new Error("Invalid start time");
  if (endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) throw new Error("Invalid end time");
  return {
    source_id: sourceId,
    title,
    start_date: startDate,
    end_date: endDate,
    start_time: startTime,
    end_time: endTime,
  };
}


/**
 * Owner-only Google Calendar sync configuration.
 *
 * Every handler re-checks that the caller owns the household it is acting on, so
 * editors and viewers cannot configure sync even by calling the endpoint
 * directly. Tokens are handled purely server-side.
 */

export interface CalendarSlot {
  id: string;
  name: string;
  external_calendar_id: string | null;
  is_main: boolean;
  /** display-only: normal event cards vs. background coverage shading */
  display_mode: "events" | "coverage_background";
  last_synced_at: string | null;
  sync_status: string;
  sync_error: string | null;
  /** IANA timezone Google reports for this calendar, when known. */
  google_time_zone: string | null;
  /** True when this calendar was created by the app and is safe to auto-fix. */
  app_managed_calendar: boolean;
}

export interface SyncSettings {
  is_owner: boolean;
  connection: {
    account_email: string;
    status: string;
    last_error: string | null;
    last_synced_at: string | null;
    manual_sync_started_at: string | null;
    manual_sync_error: string | null;
    manual_sync_running: boolean;
  } | null;
  calendars: CalendarSlot[];
  max_calendars: number;
  /** Household IANA timezone used for all timed Google sync. */
  household_time_zone: string;
  include_google_event_initials: boolean;
}

export const getSyncSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SyncSettings> => {
    const { resolveOwnedFamily } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) {
      return {
        is_owner: false,
        connection: null,
        calendars: [],
        max_calendars: 2,
        household_time_zone: "America/Los_Angeles",
        include_google_event_initials: true,
      };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: connection } = await supabaseAdmin
      .from("google_connections")
      .select(
        "account_email, status, last_error, last_synced_at, manual_sync_started_at, manual_sync_error",
      )
      .eq("family_id", family)
      .maybeSingle();
    const { data: calendars } = await supabaseAdmin
      .from("calendar_sources")
      .select(
        "id, name, external_calendar_id, is_main, display_mode, last_synced_at, sync_status, sync_error, google_time_zone, app_managed_calendar",
      )
      .eq("family_id", family)
      .eq("provider", "google")
      .order("sort_order", { ascending: true });
    const { normalizeTimeZone } = await import("@/lib/google/timezone");
    const { data: familyRow } = await supabaseAdmin
      .from("families")
      .select("timezone, include_google_event_initials")
      .eq("id", family)
      .maybeSingle();
    return {
      is_owner: true,
      connection: connection
        ? {
            ...connection,
            manual_sync_running: Boolean(
              connection.manual_sync_started_at &&
                Date.now() - Date.parse(connection.manual_sync_started_at) < 10 * 60_000,
            ),
          }
        : null,
      calendars: (calendars ?? []) as CalendarSlot[],
      max_calendars: 2,
      household_time_zone: normalizeTimeZone(familyRow?.timezone as string | null),
      include_google_event_initials: familyRow?.include_google_event_initials !== false,
    };
  });

export const setGoogleEventTitleInitials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { enabled: boolean }) => {
    if (typeof input?.enabled !== "boolean") throw new Error("Invalid title setting");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { resolveOwnedFamily, setGoogleEventInitials } = await import(
      "@/lib/google-settings.server"
    );
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can configure calendar sync");
    return setGoogleEventInitials(family, data.enabled);
  });

export const startGoogleCalendarConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { resolveOwnedFamily } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can configure calendar sync");

    const clientAPIKey = process.env["GOOGLE_CALENDAR_APP_USER_CONNECTOR_CLIENT_API_KEY"];
    if (!clientAPIKey) throw new Error("Google Calendar connector client is not configured");

    const request = getRequest();
    if (!request) throw new Error("Connecting Google must start from an app request");
    const url = new URL(request.url);
    const sandboxHost =
      url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
    const origin = sandboxHost ? `https://${sandboxHost}` : url.origin;
    const returnUrl = new URL("/oauth/google-calendar/return", origin).toString();

    const { authorizeAppUserOAuth } = await import("@/integrations/lovable/appUserConnector");
    const { GOOGLE_SCOPES, GATEWAY_BASE_URL } = await import("@/lib/google/api.server");
    const { existingConnectionKey } = await import("@/lib/google-settings.server");
    const previous = await existingConnectionKey(family);

    const { authorizationUrl } = await authorizeAppUserOAuth({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectorId: "google_calendar",
      appUserId: context.userId,
      clientAPIKey,
      returnUrl,
      connectionAPIKey: previous ?? undefined,
      credentialsConfiguration: { scopes: GOOGLE_SCOPES },
    });
    return { authorizationUrl };
  });

export const completeGoogleCalendarConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string }) => {
    if (!input?.code) throw new Error("Missing OAuth code");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { resolveOwnedFamily, saveConnection } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can configure calendar sync");

    const { exchangeAppUserOAuthCode } = await import("@/integrations/lovable/appUserConnector");
    const { GATEWAY_BASE_URL } = await import("@/lib/google/api.server");
    const { connectionAPIKey, connectorId } = await exchangeAppUserOAuthCode(
      GATEWAY_BASE_URL,
      data.code,
    );
    if (connectorId !== "google_calendar") {
      throw new Error("OAuth completion returned the wrong connector");
    }
    return saveConnection(family, context.userId, connectionAPIKey);
  });

export const listGoogleCalendars = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { resolveOwnedFamily } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can configure calendar sync");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getConnection } = await import("@/lib/google/sync.server");
    const conn = await getConnection(supabaseAdmin, family);
    if (!conn) return { calendars: [] as { id: string; summary: string }[] };
    const { listCalendars } = await import("@/lib/google/api.server");
    const calendars = await listCalendars(conn.connectionKey);
    return {
      calendars: calendars.map((c) => ({ id: c.id, summary: c.summary || c.id })),
    };
  });

export const connectCalendarSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      mode: "create" | "existing";
      name?: string;
      external_calendar_id?: string;
      replace_source_id?: string | null;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const { resolveOwnedFamily, attachCalendar } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can configure calendar sync");
    return attachCalendar(family, data);
  });

export const linkOfcCalendarToGoogle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { source_id: string; mode: "create" | "existing"; name?: string; external_calendar_id?: string }) => {
      const source_id = String(input?.source_id ?? "").trim();
      if (!source_id) throw new Error("Choose a calendar");
      if (input?.mode !== "create" && input?.mode !== "existing") throw new Error("Invalid link mode");
      return {
        source_id,
        mode: input.mode,
        name: input.name ? String(input.name).slice(0, 100) : undefined,
        external_calendar_id: input.external_calendar_id ? String(input.external_calendar_id) : undefined,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { resolveOwnedFamily, linkOfcCalendar } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can link calendars to Google");
    return linkOfcCalendar(family, data);
  });

export const renameCalendarSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { source_id: string; name: string }) => input)
  .handler(async ({ data, context }) => {
    const { resolveOwnedFamily, renameSlot } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can configure calendar sync");
    return renameSlot(family, data.source_id, data.name);
  });

export const setCalendarDisplayMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { source_id: string; display_mode: "events" | "coverage_background" }) => {
    if (input.display_mode !== "events" && input.display_mode !== "coverage_background") {
      throw new Error("Unknown display style");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { resolveOwnedFamily, setDisplayMode } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can configure calendar sync");
    return setDisplayMode(family, data.source_id, data.display_mode);
  });

/** Presentation metadata only — never written back to Google. */
export const setCalendarAppearance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { source_id: string; color: string; icon: string | null }) => input)
  .handler(async ({ data, context }) => {
    const { assertCalendarColor, assertCalendarIcon } = await import("@/lib/calendar-appearance");
    const color = assertCalendarColor(data.color);
    const icon = assertCalendarIcon(data.icon);
    const { resolveOwnedFamily, setAppearance } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can configure calendar sync");
    return setAppearance(family, data.source_id, color, icon);
  });

export const setMainCalendarSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { source_id: string }) => input)
  .handler(async ({ data, context }) => {
    const { resolveOwnedFamily, setMain } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can configure calendar sync");
    return setMain(family, data.source_id);
  });

export const disconnectCalendarSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { source_id: string }) => input)
  .handler(async ({ data, context }) => {
    const { resolveOwnedFamily, detachCalendar } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can configure calendar sync");
    return detachCalendar(family, data.source_id);
  });

export const disconnectGoogleAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { resolveOwnedFamily, disconnectAccount } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can configure calendar sync");
    return disconnectAccount(family);
  });

export const syncNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { initial?: boolean } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const { resolveOwnedFamily } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can run calendar sync");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: locks, error } = await supabaseAdmin.rpc("try_start_google_manual_sync", {
      _family_id: family,
      _stale_before: staleBefore,
    });
    if (error) {
      console.error("[google-sync] could not acquire manual sync lock", error);
      throw new Error("Couldn’t start sync. Try again.");
    }
    const lock = locks?.[0];
    if (!lock?.accepted || !lock.attempt_id) return { accepted: true, already_running: true };

    console.log("[google-sync] manual sync accepted", {
      familyId: family,
      attemptId: lock.attempt_id,
    });
    const request = getRequest();
    const callbackUrl = request
      ? new URL("/api/public/google-calendar/manual-sync", request.url).toString()
      : null;
    const { error: enqueueError } = callbackUrl
      ? await supabaseAdmin.rpc("enqueue_google_manual_sync", {
          _callback_url: callbackUrl,
          _family_id: family,
          _attempt_id: lock.attempt_id,
          _initial: data.initial ?? false,
        })
      : { error: new Error("Manual sync callback URL is unavailable") };
    if (enqueueError) {
      console.error("[google-sync] could not enqueue accepted manual sync", enqueueError);
      const { data: released, error: releaseError } = await supabaseAdmin
        .from("google_connections")
        .update({
          manual_sync_started_at: null,
          manual_sync_error: "Couldn’t start sync. Try again.",
        })
        .eq("family_id", family)
        .eq("manual_sync_attempt_id", lock.attempt_id)
        .select("id");
      const affectedRows = released?.length ?? 0;
      console.log("[google-sync] failed enqueue release attempted", {
        familyId: family,
        attemptId: lock.attempt_id,
        affectedRows,
      });
      if (releaseError) console.error("[google-sync] failed enqueue release failed", releaseError);
      if (affectedRows === 0) console.warn("[google-sync] failed enqueue release affected 0 rows");
      throw new Error("Couldn’t start sync. Try again.");
    }
    // The durable callback can sit in the database HTTP queue for minutes, so
    // run the accepted attempt right here too. The callback stays as a backup
    // and skips itself once this attempt has been released.
    const { runAcceptedManualSync } = await import("@/lib/google/sync.server");
    await runAcceptedManualSync(supabaseAdmin, family, lock.attempt_id, data.initial ?? false);
    return { accepted: true, already_running: false };
  });

/**
 * App-open freshness pull. Any authenticated household member may refresh the
 * household's Google data (read-only refresh — no sync configuration rights).
 * Skipped when the household synced within the freshness window.
 */
export const FRESHNESS_WINDOW_MS = 90_000;

export const refreshHouseholdCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { resolveMembership } = await import("@/lib/calendar-ops");
    const family = await resolveMembership(context.supabase as never, context.userId);
    if (!family) return { skipped: "no_household" as const };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: connection } = await supabaseAdmin
      .from("google_connections")
      .select("status, last_synced_at")
      .eq("family_id", family)
      .maybeSingle();
    if (!connection || connection.status !== "connected") {
      return { skipped: "not_connected" as const };
    }
    const last = connection.last_synced_at ? Date.parse(connection.last_synced_at) : 0;
    if (last && Date.now() - last < FRESHNESS_WINDOW_MS) {
      return { skipped: "fresh" as const };
    }

    const { pullHousehold } = await import("@/lib/google/sync.server");
    return pullHousehold(supabaseAdmin, family, false);
  });

/**
 * Narrow owner-only repair action: re-reads the authoritative recurrence of
 * Google-linked recurring series and rewrites local rules that lost BYDAY
 * before the recurrence fix. Idempotent and safe to run repeatedly.
 */
export const repairGoogleRecurrence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { event_ids?: string[] } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const { resolveOwnedFamily } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can repair calendar recurrence");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { repairGoogleRecurrenceRules } = await import("@/lib/google/sync.server");
    return repairGoogleRecurrenceRules(
      supabaseAdmin,
      family,
      data.event_ids && data.event_ids.length > 0 ? data.event_ids : null,
    );
  });

/**
 * Developer/owner-only read-only inbound-sync diagnostic: what does Google hold
 * for one calendar on one day, and what would normal sync do with each item.
 * Mutates nothing.
 */
export const diagnoseGoogleInbound = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { source_id: string; date: string }) => {
    const sourceId = String(input?.source_id ?? "").trim();
    const date = String(input?.date ?? "").trim();
    if (!sourceId) throw new Error("Pick a Google calendar to inspect");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pick a date (YYYY-MM-DD)");
    return { source_id: sourceId, date };
  })
  .handler(async ({ data, context }) => {
    const { resolveOwnedFamily } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can run sync diagnostics");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { diagnoseGoogleDay } = await import("@/lib/google/diagnostics.server");
    return diagnoseGoogleDay(supabaseAdmin, family, data.source_id, data.date);
  });

/**
 * Targeted repair: pushes one selected Google event through the existing
 * inbound pipeline. Idempotent, keeps existing linkage, touches nothing else.
 */
export const reapplyGoogleInboundEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { source_id: string; google_event_id: string }) => {
    const sourceId = String(input?.source_id ?? "").trim();
    const googleEventId = String(input?.google_event_id ?? "").trim();
    if (!sourceId || !googleEventId) throw new Error("A calendar and Google event id are required");
    return { source_id: sourceId, google_event_id: googleEventId };
  })
  .handler(async ({ data, context }) => {
    const { resolveOwnedFamily } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can repair calendar events");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { reapplyGoogleEvent } = await import("@/lib/google/diagnostics.server");
    return reapplyGoogleEvent(supabaseAdmin, family, data.source_id, data.google_event_id);
  });

/**
 * Developer/owner-only backfill: full-window (no sync token) reconciliation of
 * one Google calendar so previously missed future events get imported. Never
 * resets the incremental sync token and never deletes local events.
 */
export const backfillGoogleSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { source_id: string; cursor?: string | null }) => {
    const sourceId = String(input?.source_id ?? "").trim();
    if (!sourceId) throw new Error("Pick a Google calendar to backfill");
    const cursor = input?.cursor ? String(input.cursor) : null;
    return { source_id: sourceId, cursor };
  })
  .handler(async ({ data, context }) => {
    const { resolveOwnedFamily } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can backfill calendars");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { backfillSource } = await import("@/lib/google/backfill.server");
    return backfillSource(supabaseAdmin, family, data.source_id, new Date(), data.cursor);
  });


/**
 * Owner-only unlock for the Calendar Maintenance tools.
 *
 * The expected code lives only in the server environment (MAINTENANCE_CODE) and
 * is compared with a timing-safe digest check, so it is never present in client
 * code. Unlocking grants no server privileges by itself: every maintenance
 * action still re-authorizes the caller as a household owner.
 */
export const unlockCalendarMaintenance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string }) => ({ code: String(input?.code ?? "") }))
  .handler(async ({ data, context }) => {
    const { resolveOwnedFamily } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can open calendar maintenance");

    const expected = process.env["MAINTENANCE_CODE"];
    if (!expected) throw new Error("Maintenance is not configured");

    const { createHash, timingSafeEqual } = await import("node:crypto");
    const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
    const ok = timingSafeEqual(digest(data.code.trim()), digest(expected.trim()));
    return { ok };
  });

export interface WatchChannelHealth {
  source_id: string;
  name: string;
  /** active = registered and comfortably in date; expiring = under 24h left */
  state: "active" | "expiring" | "expired" | "missing";
  expires_at: string | null;
  last_notification_at: string | null;
  /** true once Google has ever delivered a push notification for this calendar */
  push_confirmed: boolean;
}

/**
 * Owner-only watch-channel health for the locked maintenance panel: shows
 * whether near-real-time Google -> app push notifications are actually active,
 * or whether the household is silently relying on the 15-minute reconcile.
 * Never returns channel tokens or resource ids.
 */
export const getWatchChannelHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ calendars: WatchChannelHealth[] }> => {
    const { resolveOwnedFamily } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can view sync diagnostics");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("calendar_sources")
      .select(
        "id, name, google_channel_id, google_channel_expires_at, google_channel_last_notified_at",
      )
      .eq("family_id", family)
      .eq("provider", "google")
      .order("sort_order", { ascending: true });

    const now = Date.now();
    const calendars = ((data ?? []) as {
      id: string;
      name: string;
      google_channel_id: string | null;
      google_channel_expires_at: string | null;
      google_channel_last_notified_at: string | null;
    }[]).map((row) => {
      const expiresMs = row.google_channel_expires_at
        ? Date.parse(row.google_channel_expires_at)
        : null;
      const state: WatchChannelHealth["state"] = !row.google_channel_id
        ? "missing"
        : expiresMs === null
          ? "active"
          : expiresMs <= now
            ? "expired"
            : expiresMs - now < 24 * 60 * 60 * 1000
              ? "expiring"
              : "active";
      return {
        source_id: row.id,
        name: row.name,
        state,
        expires_at: row.google_channel_expires_at,
        last_notification_at: row.google_channel_last_notified_at,
        push_confirmed: Boolean(row.google_channel_last_notified_at),
      };
    });
    return { calendars };
  });

/** Owner-only: registers any missing/expiring push channels right now. */
export const refreshWatchChannels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { resolveOwnedFamily } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can manage sync channels");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { ensureWatchChannelsForFamily } = await import("@/lib/google/sync.server");
    await ensureWatchChannelsForFamily(supabaseAdmin, family);
    return { ok: true as const };
  });


/**
 * Owner-only, read-only row inspection for a single Google instance: local rows,
 * parent series, projection fields, assignments and link bookkeeping. Mutates
 * nothing; used behind the locked Calendar Maintenance panel.
 */
export const inspectOccurrenceRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { google_event_id: string }) => {
    const googleEventId = String(input?.google_event_id ?? "").trim();
    if (!googleEventId) throw new Error("A Google event id is required");
    return { google_event_id: googleEventId };
  })
  .handler(async ({ data, context }) => {
    const { resolveOwnedFamily } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can inspect calendar rows");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { inspectOccurrence } = await import("@/lib/google/diagnostics.server");
    return inspectOccurrence(supabaseAdmin, family, data.google_event_id);
  });

/**
 * Owner-only, read-only DST repair diagnostic for one linked Google recurring
 * master. Reports how the existing repair path classifies it (HEALTHY / STALE /
 * SKIPPED), the probe occurrence, expected vs. actual times and the exact body a
 * repair would PATCH. Writes nothing to Google or the database.
 */
export const diagnoseGoogleDstRepair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { google_event_id: string }) => {
    const googleEventId = String(input?.google_event_id ?? "").trim();
    if (!googleEventId) throw new Error("A Google master event id is required");
    return { google_event_id: googleEventId };
  })
  .handler(async ({ data, context }) => {
    const { resolveOwnedFamily } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can run sync diagnostics");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { diagnoseDstRepair } = await import("@/lib/google/sync.server");
    return diagnoseDstRepair(supabaseAdmin, family, data.google_event_id);
  });

/** Owner-only, read-only preview for exact standalone-event cleanup. */
export const previewBulkDeleteMatchingEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: BulkDeleteFilters) => validateBulkDeleteFilters(input))
  .handler(async ({ data, context }) => {
    const { resolveOwnedFamily } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can preview bulk deletion");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { previewBulkDelete } = await import("@/lib/google/bulk-delete.server");
    return previewBulkDelete(supabaseAdmin, family, data);
  });

/** Owner-only destructive action; re-runs and fingerprints the preview first. */
export const deleteBulkMatchingEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: BulkDeleteFilters & { preview_token: string; targets: BulkDeleteTarget[] }) => {
    const targets = Array.isArray(input?.targets)
      ? input.targets.map((target) => ({
          key: String(target?.key ?? "").trim(),
          title: String(target?.title ?? "").trim(),
          date: String(target?.date ?? "").trim(),
          google_event_ids: Array.isArray(target?.google_event_ids)
            ? target.google_event_ids.map((id) => String(id).trim()).filter(Boolean)
            : [],
          ofc_event_id: target?.ofc_event_id ? String(target.ofc_event_id).trim() : null,
        }))
      : [];
    return {
      filters: validateBulkDeleteFilters(input),
      preview_token: String(input?.preview_token ?? "").trim(),
      targets,
    };
  })
  .handler(async ({ data, context }) => {
    if (!data.preview_token) throw new Error("Preview matches before deleting");
    if (data.targets.length === 0) throw new Error("No eligible previewed event IDs were provided");
    const { resolveOwnedFamily } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can delete matching events");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { deleteBulkMatches } = await import("@/lib/google/bulk-delete.server");
    return deleteBulkMatches(
      supabaseAdmin,
      family,
      data.filters,
      data.preview_token,
      data.targets,
    );
  });

/**
 * Owner-only repair for Apple/iCloud subscription events that were exported to
 * Google before subscription sources were excluded from outbound push.
 *
 * Deletes only the Google copies (and their link rows). The Apple-sourced event
 * inside the app is preserved, and the Apple source calendar is never touched.
 */
export const detachSubscriptionEventsFromGoogle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ events: number; google_deleted: number }> => {
    const { resolveOwnedFamily } = await import("@/lib/google-settings.server");
    const family = await resolveOwnedFamily(context.supabase, context.userId);
    if (!family) throw new Error("Only household owners can run calendar maintenance");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pushEventDeletion, subscriptionSourceIds } = await import("@/lib/google/sync.server");

    const sourceIds = [...(await subscriptionSourceIds(supabaseAdmin as never, family))];
    if (sourceIds.length === 0) return { events: 0, google_deleted: 0 };

    const { data: rows } = await supabaseAdmin
      .from("events")
      .select("id")
      .eq("family_id", family)
      .in("calendar_source_id", sourceIds);
    const eventIds = ((rows ?? []) as { id: string }[]).map((r) => r.id);
    if (eventIds.length === 0) return { events: 0, google_deleted: 0 };

    const { data: links } = await supabaseAdmin
      .from("event_sync_links")
      .select("id, google_event_id, calendar_source_id")
      .eq("family_id", family)
      .in("event_id", eventIds);
    const linkRows = (links ?? []) as {
      id: string;
      google_event_id: string;
      calendar_source_id: string;
    }[];
    if (linkRows.length === 0) return { events: eventIds.length, google_deleted: 0 };

    await pushEventDeletion(supabaseAdmin as never, family, linkRows);
    await supabaseAdmin
      .from("event_sync_links")
      .delete()
      .in("id", linkRows.map((l) => l.id));
    return { events: eventIds.length, google_deleted: linkRows.length };
  });
