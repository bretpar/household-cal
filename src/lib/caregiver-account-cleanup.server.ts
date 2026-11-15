/** Fail closed: retain shifts and delivery records until Google deletions and revocation finish. */
export async function cleanupCaregiverGoogleForDeletion(userId: string) {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data: connection, error } = await db.from("caregiver_google_connections").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!connection) return;
  if (connection.calendar_id && connection.status !== "disconnected") {
    const { error: prepareError } = await db.rpc("prepare_caregiver_google_deletion", { _user: userId });
    if (prepareError) throw new Error(prepareError.message);
    const { syncCaregiverWork } = await import("@/lib/caregiver-google.server");
    await syncCaregiverWork(userId, 100);
    const { data: remaining, error: pendingError } = await db.from("caregiver_google_deliveries").select("shift_id")
      .eq("user_id", userId).or("status.neq.synced,lease_until.not.is.null").limit(1);
    if (pendingError) throw new Error(pendingError.message);
    if (remaining?.length) throw new Error("Account deletion is paused while Google shifts are removed. Your deletion requests are saved; wait for sync, then try deleting your account again.");
  }
  if (connection.calendar_id && connection.status === "disconnected") {
    const { data: live, error: liveError } = await db.from("caregiver_work_shifts").select("id").eq("user_id", userId).is("deleted_at", null).limit(1);
    const { data: pending, error: pendingError } = await db.from("caregiver_google_deliveries").select("shift_id").eq("user_id", userId).or("status.neq.synced,lease_until.not.is.null").limit(1);
    if (liveError || pendingError) throw new Error("Could not verify personal Google cleanup");
    if (live?.length || pending?.length) throw new Error("Reconnect personal Google before deleting your account so remaining remote shifts can be removed.");
  }
  if (connection.status !== "disconnected" && connection.connection_key_ciphertext) {
    const { decryptConnectionKey } = await import("@/lib/google/crypto.server");
    const { disconnectAppUser } = await import("@/integrations/lovable/appUserConnector");
    const { GATEWAY_BASE_URL } = await import("@/lib/google/api.server");
    await disconnectAppUser({ gatewayBaseUrl: GATEWAY_BASE_URL, connectorId: "google_calendar", connectionAPIKey: decryptConnectionKey(connection.connection_key_ciphertext) });
    const { error: revokeError } = await db.from("caregiver_google_connections").update({ status: "disconnected", connection_key_ciphertext: "" }).eq("user_id", userId).eq("connection_key_ciphertext", connection.connection_key_ciphertext);
    if (revokeError) throw new Error(revokeError.message);
  }
}