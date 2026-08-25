/**
 * Server-only Google Calendar sync configuration helpers.
 *
 * All of these run with the service-role client but only ever after the calling
 * server function has verified the user owns the household in question.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { encryptConnectionKey, decryptConnectionKey } from "@/lib/google/crypto.server";
import {
  createCalendar,
  getAccountEmail,
  renameCalendar as renameGoogleCalendar,
} from "@/lib/google/api.server";
import { getConnection, pullHousehold } from "@/lib/google/sync.server";

type Client = { from: (table: string) => any };

/** Returns the household id the user owns, or null when they are not an owner. */
export async function resolveOwnedFamily(
  client: Client,
  userId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("family_users")
    .select("family_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  return (data?.[0]?.family_id as string | undefined) ?? null;
}

/** The stored connection key, used to authorise a reconnect. */
export async function existingConnectionKey(familyId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("google_connections")
    .select("id")
    .eq("family_id", familyId)
    .maybeSingle();
  if (!data) return null;
  const { data: secret } = await supabaseAdmin
    .from("google_connection_secrets")
    .select("connection_key_ciphertext")
    .eq("connection_id", data.id)
    .maybeSingle();
  return secret ? decryptConnectionKey(secret.connection_key_ciphertext) : null;
}

/** Stores (or refreshes) the household's Google connection after consent. */
export async function saveConnection(
  familyId: string,
  userId: string,
  connectionKey: string,
): Promise<{ account_email: string }> {
  const accountEmail = (await getAccountEmail(connectionKey)) ?? "google-account";

  const { data: connection, error } = await supabaseAdmin
    .from("google_connections")
    .upsert(
      {
        family_id: familyId,
        connected_by: userId,
        account_email: accountEmail,
        google_account_id: accountEmail,
        status: "connected",
        last_error: null,
      },
      { onConflict: "family_id" },
    )
    .select("id")
    .single();
  if (error) throw error;

  const { error: secretError } = await supabaseAdmin.from("google_connection_secrets").upsert(
    {
      connection_id: connection.id,
      connection_key_ciphertext: encryptConnectionKey(connectionKey),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "connection_id" },
  );
  if (secretError) throw secretError;

  // reconnect: pick up anything that changed while we were disconnected
  await pullHousehold(supabaseAdmin, familyId, false);
  return { account_email: accountEmail };
}

/** Connects a Google calendar into one of the two household slots. */
export async function attachCalendar(
  familyId: string,
  input: {
    mode: "create" | "existing";
    name?: string | undefined;
    external_calendar_id?: string | undefined;
    replace_source_id?: string | null | undefined;
  },
): Promise<{ source_id: string }> {
  const conn = await getConnection(supabaseAdmin, familyId);
  if (!conn) throw new Error("Connect a Google account first");

  let calendarId = input.external_calendar_id ?? null;
  let name = (input.name ?? "").trim();

  if (input.mode === "create") {
    if (!name) throw new Error("Give the new calendar a name");
    const created = await createCalendar(conn.connectionKey, name);
    calendarId = created.id;
  }
  if (!calendarId) throw new Error("Choose a Google calendar");
  if (!name) name = calendarId;

  if (input.replace_source_id) {
    // Only ever reached from an explicit owner choice — the app never switches
    // sync targets on its own. Local events survive; only the Google mappings
    // for the old calendar go away, so nothing is re-imported twice.
    await supabaseAdmin.from("event_sync_links").delete().eq("calendar_source_id", input.replace_source_id);
    const { error } = await supabaseAdmin
      .from("calendar_sources")
      .update({
        name,
        sync_status: "active",
        sync_error: null,
        sync_failure_count: 0,
        sync_paused_at: null,
        external_calendar_id: calendarId,
        provider: "google",
        google_sync_token: null,
        google_channel_id: null,
        google_channel_resource_id: null,
        google_channel_expires_at: null,
      })
      .eq("id", input.replace_source_id)
      .eq("family_id", familyId);
    if (error) throw error;
    await pullHousehold(supabaseAdmin, familyId, true);
    return { source_id: input.replace_source_id };
  }

  const { count } = await supabaseAdmin
    .from("calendar_sources")
    .select("id", { count: "exact", head: true })
    .eq("family_id", familyId)
    .eq("provider", "google");
  if ((count ?? 0) >= 2) throw new Error("You can connect at most two Google calendars");

  const { data: mainExists } = await supabaseAdmin
    .from("calendar_sources")
    .select("id")
    .eq("family_id", familyId)
    .eq("is_main", true)
    .maybeSingle();

  const { data, error } = await supabaseAdmin
    .from("calendar_sources")
    .insert({
      family_id: familyId,
      name,
      provider: "google",
      external_calendar_id: calendarId,
      display_mode: "events",
      active: true,
      is_main: !mainExists,
      sort_order: (count ?? 0) + 1,
    })
    .select("id")
    .single();
  if (error) throw error;

  await pullHousehold(supabaseAdmin, familyId, true);
  return { source_id: data.id as string };
}

export async function renameSlot(
  familyId: string,
  sourceId: string,
  name: string,
): Promise<{ ok: true }> {
  const clean = name.trim();
  if (!clean) throw new Error("Give the calendar a name");
  const { data: source } = await supabaseAdmin
    .from("calendar_sources")
    .select("external_calendar_id")
    .eq("id", sourceId)
    .eq("family_id", familyId)
    .maybeSingle();
  if (!source) throw new Error("Calendar not found");

  const conn = await getConnection(supabaseAdmin, familyId);
  if (conn && source.external_calendar_id) {
    // Google only allows renaming calendars the account owns; ignore refusals.
    try {
      await renameGoogleCalendar(conn.connectionKey, source.external_calendar_id, clean);
    } catch (error) {
      console.error("[google-sync] rename in Google failed", error);
    }
  }
  const { error } = await supabaseAdmin
    .from("calendar_sources")
    .update({ name: clean })
    .eq("id", sourceId)
    .eq("family_id", familyId);
  if (error) throw error;
  return { ok: true };
}

export async function setMain(familyId: string, sourceId: string): Promise<{ ok: true }> {
  await supabaseAdmin
    .from("calendar_sources")
    .update({ is_main: false })
    .eq("family_id", familyId)
    .eq("is_main", true);
  const { error } = await supabaseAdmin
    .from("calendar_sources")
    .update({ is_main: true })
    .eq("id", sourceId)
    .eq("family_id", familyId);
  if (error) throw error;
  return { ok: true };
}

/**
 * Removes a calendar from the app. The underlying Google calendar is left
 * completely alone — only the local mapping and the slot go away.
 */
export async function detachCalendar(familyId: string, sourceId: string): Promise<{ ok: true }> {
  const { data: source } = await supabaseAdmin
    .from("calendar_sources")
    .select("id, is_main, google_channel_id, google_channel_resource_id")
    .eq("id", sourceId)
    .eq("family_id", familyId)
    .maybeSingle();
  if (!source) throw new Error("Calendar not found");

  const conn = await getConnection(supabaseAdmin, familyId);
  if (conn && source.google_channel_id && source.google_channel_resource_id) {
    const { stopChannel } = await import("@/lib/google/api.server");
    await stopChannel(conn.connectionKey, source.google_channel_id, source.google_channel_resource_id);
  }

  await supabaseAdmin.from("event_sync_links").delete().eq("calendar_source_id", sourceId);
  // local events stay, they simply stop syncing
  await supabaseAdmin
    .from("calendar_sources")
    .update({
      provider: "local",
      external_calendar_id: null,
      google_sync_token: null,
      google_channel_id: null,
      google_channel_resource_id: null,
      google_channel_expires_at: null,
      is_main: false,
    })
    .eq("id", sourceId);

  if (source.is_main) {
    const { data: next } = await supabaseAdmin
      .from("calendar_sources")
      .select("id")
      .eq("family_id", familyId)
      .eq("provider", "google")
      .order("sort_order", { ascending: true })
      .limit(1);
    if (next?.[0]) await setMain(familyId, next[0].id);
  }
  return { ok: true };
}

/**
 * Disconnects the Google account. Local events are never deleted; the household
 * simply stops syncing until an owner reconnects.
 */
export async function disconnectAccount(familyId: string): Promise<{ ok: true }> {
  const conn = await getConnection(supabaseAdmin, familyId);
  if (conn) {
    const { disconnectAppUser } = await import("@/integrations/lovable/appUserConnector");
    const { GATEWAY_BASE_URL } = await import("@/lib/google/api.server");
    try {
      await disconnectAppUser({
        gatewayBaseUrl: GATEWAY_BASE_URL,
        connectionAPIKey: conn.connectionKey,
        connectorId: "google_calendar",
      });
    } catch (error) {
      console.error("[google-sync] gateway disconnect failed", error);
    }
  }
  await supabaseAdmin.from("google_connections").delete().eq("family_id", familyId);
  await supabaseAdmin
    .from("calendar_sources")
    .update({
      google_sync_token: null,
      google_channel_id: null,
      google_channel_resource_id: null,
      google_channel_expires_at: null,
    })
    .eq("family_id", familyId)
    .eq("provider", "google");
  return { ok: true };
}
