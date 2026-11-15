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
  .inputValidator(z.object({ challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), native: z.boolean() }))
  .handler(async ({ data, context }) => {
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
    const { randomBytes } = await import("node:crypto");
    const state = randomBytes(32).toString("base64url");
    const { data: attempt, error: attemptError } = await db.from("caregiver_google_oauth_attempts").insert({ user_id: context.userId, challenge: data.challenge, return_secret: state, mode: data.native ? "native" : "web" }).select("id").single();
    if (attemptError || !attempt) throw new Error("Could not start Google authorization");
    const returnUrl = new URL("/api/public/caregiver-google/return", origin);
    returnUrl.searchParams.set("attempt", attempt.id);
    returnUrl.searchParams.set("state", state);
    const auth = await authorizeAppUserOAuth({ gatewayBaseUrl: GATEWAY_BASE_URL, connectorId: "google_calendar", appUserId: context.userId,
      clientAPIKey: key, returnUrl: returnUrl.toString(), credentialsConfiguration: { scopes: GOOGLE_SCOPES } });
    return { authorizationUrl: auth.authorizationUrl, attempt: attempt.id, state };
  });
export const completeCaregiverGoogle = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ attempt: z.string().uuid(), verifier: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })).handler(async ({ data, context }) => {
    const { db } = await personalConnection(context.userId);
    const { oauthChallenge } = await import("@/lib/caregiver-google-oauth.server");
    const { data: storedCode, error: claimError } = await db.rpc("claim_caregiver_google_oauth", { _user: context.userId, _attempt: data.attempt, _challenge: oauthChallenge(data.verifier) });
    if (claimError || !storedCode) throw new Error(claimError?.message ?? "Google authorization did not match");
    const { exchangeAppUserOAuthCode } = await import("@/integrations/lovable/appUserConnector");
    const { encryptConnectionKey, decryptConnectionKey } = await import("@/lib/google/crypto.server");
    const { GATEWAY_BASE_URL, getAccountEmail } = await import("@/lib/google/api.server");
    const exchange = await exchangeAppUserOAuthCode(GATEWAY_BASE_URL, decryptConnectionKey(storedCode));
    if (exchange.connectorId !== "google_calendar") throw new Error("Wrong Google connection returned");
    const email = await getAccountEmail(exchange.connectionAPIKey);
    if (!email) throw new Error("Google account identity could not be verified");
    const { error } = await db.rpc("save_caregiver_google_oauth", { _user: context.userId, _attempt: data.attempt, _ciphertext: encryptConnectionKey(exchange.connectionAPIKey), _email: email });
    if (error) throw new Error(error.message);
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
    // Do not clear a newer reconnect that finished while revoking the old key.
    const { error } = await db.from("caregiver_google_connections").update({ status: "disconnected", connection_key_ciphertext: "", updated_at: new Date().toISOString() })
      .eq("user_id", context.userId).eq("connection_key_ciphertext", connection.connection_key_ciphertext);
    if (error) throw new Error(error.message);
    return { ok: true };
  });