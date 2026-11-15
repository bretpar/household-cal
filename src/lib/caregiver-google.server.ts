import { decryptConnectionKey } from "@/lib/google/crypto.server";
import { deliveryRemoteId, remoteMatchesDelivery } from "@/lib/google/delivery";
import { deleteEvent, getEventRaw, insertEvent, patchEvent } from "@/lib/google/api.server";

/** Shared Google transport/verification with personal durable leases, never household rows. */
export async function syncCaregiverWork(userId: string, limit = 20) {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data: connection, error } = await db.from("caregiver_google_connections").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!connection || connection.status !== "connected" || !connection.calendar_id) return;
  const key = decryptConnectionKey(connection.connection_key_ciphertext);
  for (let i = 0; i < limit; i++) {
    const { data: claims, error: claimError } = await db.rpc("claim_caregiver_google_delivery", { _user: userId });
    if (claimError) throw new Error(claimError.message);
    const claim = claims?.[0];
    if (!claim?.lease_token) break;
    const leaseToken = claim.lease_token;
    const assertLease = async () => {
      const { data: valid, error: leaseError } = await db.rpc("check_caregiver_google_lease", { _user: userId, _shift: claim.shift_id, _calendar: claim.calendar_id, _lease: leaseToken, _version: claim.version });
      if (leaseError) throw new Error(leaseError.message);
      if (!valid) throw new Error("Delivery changed or lease expired; sync remains pending");
    };
    let failure: string | null = null;
    try {
      const { data: shift, error: shiftError } = await db.from("caregiver_work_shifts").select("*").eq("id", claim.shift_id).eq("user_id", userId).single();
      if (shiftError || !shift) throw new Error("Personal shift could not be read");
      const { data: client, error: contactError } = await db.from("caregiver_clients").select("name").eq("id", shift.client_id).eq("user_id", userId).single();
      if (contactError || !client) throw new Error("Family contact could not be read");
      const { data: workspace, error: zoneError } = await db.from("caregiver_workspaces").select("timezone").eq("user_id", userId).single();
      if (zoneError || !workspace) throw new Error("Caregiver time zone could not be read");
      const remoteId = await deliveryRemoteId(`caregiver:${userId}:${claim.calendar_id}:${shift.id}`);
      let remote: Record<string, unknown> | null = null;
      try { remote = await getEventRaw(key, claim.calendar_id, remoteId); }
      catch (e) { if (!(e instanceof Error) || !/\[(404|410)\]/.test(e.message)) throw e; }
      // Google can retain a cancelled tombstone with no private properties.
      // It is proof of absence for deletion, never a live event to adopt.
      if (remote?.['status'] === "cancelled" && (shift.deleted_at || claim.desired_action === "delete")) remote = null;
      const properties = (remote?.['extendedProperties'] as { private?: Record<string, string> } | undefined)?.private;
      if (remote && (properties?.['ofc_caregiver_user_id'] !== userId || properties?.['ofc_caregiver_shift_id'] !== shift.id)) throw new Error("Google shift ownership could not be verified");
      if (shift.deleted_at || claim.desired_action === "delete") {
        if (remote) { await assertLease(); await deleteEvent(key, claim.calendar_id, remoteId); }
        try {
          const remaining = await getEventRaw(key, claim.calendar_id, remoteId);
          if (remaining['status'] !== "cancelled") throw new Error("Google shift deletion was not verified; cleanup remains pending");
        } catch (e) {
          if (!(e instanceof Error) || !/\[(404|410)\]/.test(e.message)) throw e;
        }
      } else {
        const body = { summary: client.name, description: shift.notes ?? "", location: "",
          start: { dateTime: shift.start_at, timeZone: workspace.timezone }, end: { dateTime: shift.end_at, timeZone: workspace.timezone },
          extendedProperties: { private: { ofc_caregiver_user_id: userId, ofc_caregiver_shift_id: shift.id, ofc_caregiver_client_id: shift.client_id } } };
        // Personal shifts have exact UTC instants; equal repeated-hour wall times
        // are not sufficient proof that Google retained their duration.
        const matchesShift = (candidate: Record<string, unknown>) => {
          const start = candidate['start'] as { dateTime?: string } | undefined;
          const end = candidate['end'] as { dateTime?: string } | undefined;
          return remoteMatchesDelivery(candidate, body, remoteId) &&
            Date.parse(start?.dateTime ?? "") === Date.parse(shift.start_at) &&
            Date.parse(end?.dateTime ?? "") === Date.parse(shift.end_at);
        };
        if (!remote) {
          await assertLease();
          try { await insertEvent(key, claim.calendar_id, { ...body, id: remoteId }); }
          catch (e) { if (!(e instanceof Error) || !/\[409\]/.test(e.message)) throw e; }
          remote = await getEventRaw(key, claim.calendar_id, remoteId);
          const createdProperties = (remote['extendedProperties'] as { private?: Record<string, string> } | undefined)?.private;
          if (createdProperties?.['ofc_caregiver_user_id'] !== userId || createdProperties?.['ofc_caregiver_shift_id'] !== shift.id) throw new Error("Google shift ownership could not be verified");
        }
        if (!matchesShift(remote)) {
          await assertLease();
          await patchEvent(key, claim.calendar_id, remoteId, body, typeof remote['etag'] === "string" ? remote['etag'] : undefined);
          remote = await getEventRaw(key, claim.calendar_id, remoteId);
        }
        if (!matchesShift(remote)) throw new Error("Google work shift was not verified after save");
      }
    } catch (e) {
      failure = e instanceof Error ? e.message : "Google work shift could not sync";
      // Provider errors remain recorded server-side; never include credentials.
      // A worker may still hold credentials from before a successful reconnect.
      // Its failure must never disconnect the newly authorized connection.
      if (/\[401\]/.test(failure)) {
        const { error: connectionError } = await db.from("caregiver_google_connections")
          .update({ status: "reconnect_required", last_error: "Reconnect Google Calendar" })
          .eq("user_id", userId).eq("status", "connected")
          .eq("connection_key_ciphertext", connection.connection_key_ciphertext);
        if (connectionError) throw new Error(connectionError.message);
      }
    }
    const { error: finishError } = await db.rpc("finish_caregiver_google_delivery", {
      _shift: claim.shift_id, _calendar: claim.calendar_id, _lease: claim.lease_token, _version: claim.version, _error: failure ?? "",
    });
    if (finishError) throw new Error(finishError.message);
    if (failure) break;
  }
}

export async function syncAllCaregiverWork() {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data, error } = await db.from("caregiver_google_connections").select("user_id").eq("status", "connected").not("calendar_id", "is", null);
  if (error) throw new Error(error.message);
  const results: Record<string, string> = {};
  for (const row of data ?? []) {
    try { await syncCaregiverWork(row.user_id); results[row.user_id] = "processed"; }
    catch { results[row.user_id] = "needs_attention"; }
  }
  return results;
}