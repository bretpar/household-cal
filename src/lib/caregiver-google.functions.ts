import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function personalConnection(userId: string) {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data: workspace, error } = await db.from("caregiver_workspaces").select("user_id").eq("user_id", userId).single();
  if (error || !workspace) throw new Error("Set up your caregiver account first");
  const { data: connection, error: connectionError } = await db.from("caregiver_google_connections").select("*").eq("user_id", userId).maybeSingle();
  if (connectionError) throw new Error(connectionError.message);
  return { db, connection };
}
export const getCaregiverGoogle = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db, connection } = await personalConnection(context.userId);
    const { data: deliveries, error } = await db.from("caregiver_google_deliveries").select("status").eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { connection: connection ? { account_email: connection.account_email, calendar_id: connection.calendar_id, calendar_name: connection.calendar_name, status: connection.status } : null,
      pending: deliveries?.filter(d => d.status === "pending").length ?? 0,
      issues: deliveries?.filter(d => d.status === "needs_attention").length ?? 0 };
  });
export const startCaregiverGoogle = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db } = await personalConnection(context.userId);
    // Google grants are per gateway identity: do not reconnect over a household grant.
    const { data: existing, error } = await db.from("google_connections").select("id").eq("connected_by", context.userId).neq("status", "disconnected").limit(1);
    if (error) throw new Error(error.message);
    if (existing?.length) throw new Error("This account already manages a household Google connection. Personal Google linking is unavailable until separate connection ownership is supported.");
    const key = process.env['GOOGLE_CALENDAR_APP_USER_CONNECTOR_CLIENT_API_KEY'];
    if (!key) throw new Error("Google Calendar is not configured");
    const request = getRequest();
    if (!request) throw new Error("Start connecting from the app");
    const url = new URL(request.url);
    const host = url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
    const origin = host ? `https://${host}` : url.origin;
    const { authorizeAppUserOAuth } = await import("@/integrations/lovable/appUserConnector");
    const { GOOGLE_SCOPES, GATEWAY_BASE_URL } = await import("@/lib/google/api.server");
    return authorizeAppUserOAuth({ gatewayBaseUrl: GATEWAY_BASE_URL, connectorId: "google_calendar", appUserId: context.userId,
      clientAPIKey: key, returnUrl: new URL("/oauth/google-calendar/return", origin).toString(), credentialsConfiguration: { scopes: GOOGLE_SCOPES } });
  });
export const completeCaregiverGoogle = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ code: z.string().min(1).max(4096) })).handler(async ({ data, context }) => {
    const { db } = await personalConnection(context.userId);
    const { exchangeAppUserOAuthCode } = await import("@/integrations/lovable/appUserConnector");
    const { encryptConnectionKey } = await import("@/lib/google/crypto.server");
    const { GATEWAY_BASE_URL, getAccountEmail } = await import("@/lib/google/api.server");
    const exchange = await exchangeAppUserOAuthCode(GATEWAY_BASE_URL, data.code);
    if (exchange.connectorId !== "google_calendar") throw new Error("Wrong Google connection returned");
    const { error } = await db.from("caregiver_google_connections").upsert({ user_id: context.userId,
      connection_key_ciphertext: encryptConnectionKey(exchange.connectionAPIKey), status: "connected", last_error: null, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    const email = await getAccountEmail(exchange.connectionAPIKey);
    const { error: emailError } = await db.from("caregiver_google_connections").update({ account_email: email }).eq("user_id", context.userId);
    if (emailError) throw new Error(emailError.message);
    return { ok: true };
  });
export const listCaregiverGoogleCalendars = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { connection } = await personalConnection(context.userId);
    if (!connection || connection.status !== "connected") return [];
    const { decryptConnectionKey } = await import("@/lib/google/crypto.server");
    const { listCalendars } = await import("@/lib/google/api.server");
    return listCalendars(decryptConnectionKey(connection.connection_key_ciphertext));
  });
export const selectCaregiverGoogleCalendar = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ calendarId: z.string().min(1).max(1024) })).handler(async ({ data, context }) => {
    const { db, connection } = await personalConnection(context.userId);
    if (!connection || connection.status !== "connected") throw new Error("Connect Google first");
    const { decryptConnectionKey } = await import("@/lib/google/crypto.server");
    const { listCalendars } = await import("@/lib/google/api.server");
    const calendars = await listCalendars(decryptConnectionKey(connection.connection_key_ciphertext));
    const calendar = calendars.find(c => c.id === data.calendarId);
    if (!calendar || (calendar.accessRole !== "writer" && calendar.accessRole !== "owner")) throw new Error("Choose a writable Google calendar");
    const { error } = await db.rpc("select_caregiver_google_calendar", { _user: context.userId, _calendar: calendar.id, _name: calendar.summary });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
export const syncCaregiverGoogle = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await personalConnection(context.userId);
    const { syncCaregiverWork } = await import("@/lib/caregiver-google.server");
    await syncCaregiverWork(context.userId);
    return { ok: true };
  });
export const disconnectCaregiverGoogle = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db, connection } = await personalConnection(context.userId);
    if (!connection || connection.status === "disconnected") return { ok: true };
    const { disconnectAppUser } = await import("@/integrations/lovable/appUserConnector");
    const { decryptConnectionKey } = await import("@/lib/google/crypto.server");
    const { GATEWAY_BASE_URL } = await import("@/lib/google/api.server");
    await disconnectAppUser({ gatewayBaseUrl: GATEWAY_BASE_URL, connectorId: "google_calendar", connectionAPIKey: decryptConnectionKey(connection.connection_key_ciphertext) });
    const { error } = await db.from("caregiver_google_connections").update({ status: "disconnected", connection_key_ciphertext: "", updated_at: new Date().toISOString() }).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });