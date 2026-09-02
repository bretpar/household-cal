import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  } | null;
  calendars: CalendarSlot[];
  max_calendars: number;
  /** Household IANA timezone used for all timed Google sync. */
  household_time_zone: string;
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
      };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: connection } = await supabaseAdmin
      .from("google_connections")
      .select("account_email, status, last_error, last_synced_at")
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
      .select("timezone")
      .eq("id", family)
      .maybeSingle();
    return {
      is_owner: true,
      connection: connection ?? null,
      calendars: (calendars ?? []) as CalendarSlot[],
      max_calendars: 2,
      household_time_zone: normalizeTimeZone(familyRow?.timezone as string | null),
    };
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
    const { reconcileHousehold, pullHousehold } = await import("@/lib/google/sync.server");
    return data.initial
      ? pullHousehold(supabaseAdmin, family, true)
      : reconcileHousehold(supabaseAdmin, family);
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
