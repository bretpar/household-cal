/**
 * Durable Google sync outbox.
 *
 * Every row is one remote operation with its full payload, so a failed delete
 * or update can be replayed even after the local event row is gone. Status is
 * per operation (pending / synced / needs_attention) and is only ever set to
 * "synced" after Google positively acknowledged the call — never because a
 * foreground wait expired.
 *
 * Service-role only: the table has no RLS policies, so all access goes through
 * the admin client after the caller has been authorized.
 */
/** Minimal admin-client surface; structurally compatible with supabaseAdmin. */
type Admin = { from: (table: string) => any };

export type OutboxKind = "create" | "update" | "delete" | "exclusion";

export interface OutboxRow {
  id: string;
  family_id: string;
  op_key: string;
  kind: OutboxKind;
  event_id: string | null;
  calendar_source_id: string | null;
  google_event_id: string | null;
  payload: Record<string, unknown>;
  status: "pending" | "synced" | "needs_attention";
  attempts: number;
  last_error: string | null;
  delivery_version: string;
}

/** Records (or refreshes) a durable operation. Idempotent on op_key. */
export async function enqueueOutbox(
  admin: Admin,
  familyId: string,
  op: {
    opKey: string;
    kind: OutboxKind;
    eventId?: string | null;
    calendarSourceId?: string | null;
    googleEventId?: string | null;
    payload: Record<string, unknown>;
    status?: "pending" | "needs_attention";
    lastError?: string | null;
  },
): Promise<void> {
  const { error } = await admin.from("google_sync_outbox").upsert(
    {
      family_id: familyId,
      op_key: op.opKey,
      kind: op.kind,
      event_id: op.eventId ?? null,
      calendar_source_id: op.calendarSourceId ?? null,
      google_event_id: op.googleEventId ?? null,
      payload: op.payload as never,
      status: op.status ?? "pending",
      last_error: op.lastError ?? null,
      updated_at: new Date().toISOString(),
      delivery_version: crypto.randomUUID(),
    },
    { onConflict: "family_id,op_key" },
  );
  if (error) throw error;
}

/** Sets the status of one operation by its stable key. */
export async function setOutboxStatusByKey(
  admin: Admin,
  familyId: string,
  opKey: string,
  status: "synced" | "needs_attention",
  lastError: string | null,
): Promise<void> {
  await admin
    .from("google_sync_outbox")
    .update({ status, last_error: lastError, updated_at: new Date().toISOString() })
    .eq("family_id", familyId)
    .eq("op_key", opKey)
    .throwOnError();
}

/** One lease covers creation, adoption and update of an exact destination branch. */
export function createIntentKey(eventId: string, branchKey: string, sourceId?: string): string {
  return sourceId ? `delivery:${eventId}:${sourceId}:${branchKey}` : `create:${eventId}:${branchKey}`;
}

export type DeliveryClaim = { state: "claimed" | "recover"; id: string; version: string; token: string };
export async function claimCreateIntent(
  admin: Admin,
  familyId: string,
  op: { eventId: string; branchKey: string; calendarSourceId: string; externalCalendarId: string; body: Record<string, unknown> },
): Promise<DeliveryClaim | { state: "held" }> {
  const { data, error } = await (admin as Admin & { rpc: (name: string, args: unknown) => Promise<any> }).rpc("claim_google_delivery", {
    _family: familyId, _key: createIntentKey(op.eventId, op.branchKey, op.calendarSourceId),
    _event: op.eventId, _source: op.calendarSourceId, _token: crypto.randomUUID(),
    _payload: { branch_key: op.branchKey, external_calendar_id: op.externalCalendarId, body: op.body },
  });
  if (error) throw error;
  if (!data || !["held", "claimed", "recover"].includes(data.state)) throw new Error("Google delivery claim was not confirmed");
  return data;
}

export async function finishDelivery(admin: Admin, familyId: string, key: string, claim: DeliveryClaim, remoteId: string | null, errorMessage: string | null): Promise<void> {
  const { data, error } = await (admin as Admin & { rpc: (name: string, args: unknown) => Promise<any> }).rpc("finish_google_delivery", {
    _family: familyId, _key: key, _token: claim.token, _version: claim.version, _remote: remoteId, _error: errorMessage,
  });
  if (error) throw error;
  if (data !== true) throw new Error("Google delivery lease or operation version changed; acknowledgment withheld");
}

/** Version fencing: an older request may not clear a newer committed local edit. */
export async function acknowledgeVersion(admin: Admin, row: Pick<OutboxRow, "id" | "delivery_version">): Promise<void> {
  const { data, error } = await admin.from("google_sync_outbox").update({ status: "synced", last_error: null })
    .eq("id", row.id).eq("delivery_version", row.delivery_version).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Newer delivery intent exists; acknowledgment withheld");
}

export async function assertDeliveryLease(admin: Admin, familyId: string, key: string, claim: DeliveryClaim): Promise<void> {
  const { data, error } = await (admin as Admin & { rpc: (name: string, args: unknown) => Promise<any> }).rpc("check_google_delivery_lease", {
    _family: familyId, _key: key, _token: claim.token, _version: claim.version,
  });
  if (error) throw error;
  if (data !== true) throw new Error("Google delivery lease expired; remote write withheld");
}

/** Replay never touches lease clocks; pushEvent itself acknowledges exact operations. */
export async function replayOutbox(admin: Admin, familyId: string): Promise<{ synced: number; attention: number; skipped: number }> {
  const { data: rows, error } = await admin.from("google_sync_outbox").select("*")
    .eq("family_id", familyId).in("status", ["pending", "needs_attention"])
    .order("created_at", { ascending: true }).limit(50);
  if (error) throw error;
  let synced = 0, attention = 0, skipped = 0;
  const sync = await import("@/lib/google/sync.server");
  for (const row of (rows ?? []) as OutboxRow[]) {
    try {
      if (row.kind === "delete") {
        const calendarId = row.payload['external_calendar_id'];
        if (row.payload['committed'] !== true || typeof calendarId !== "string" || !calendarId || !row.google_event_id || !row.calendar_source_id) {
          // Old/precommit or incomplete intents are deliberately not executable.
          skipped += 1;
          continue;
        }
        const outcome = await sync.pushEventDeletionResolved(admin, familyId, [{
          google_event_id: row.google_event_id, external_calendar_id: calendarId,
          calendar_source_id: row.calendar_source_id, event_id: row.event_id,
          local_delete: row.payload['local_delete'] === true,
        }]);
        if (!outcome.ok) throw new Error(outcome.skipped ?? "Deletion was not confirmed");
        await acknowledgeVersion(admin, row);
      } else {
        if (!row.event_id) throw new Error("Operation has no local event");
        await sync.pushEvent(admin, familyId, row.event_id, row);
      }
      const { data: current, error: readError } = await admin.from("google_sync_outbox").select("status")
        .eq("id", row.id).eq("family_id", familyId).single();
      if (readError) throw readError;
      if (current?.status === "synced") synced += 1;
      else attention += 1;
    } catch (e) {
      // Do not modify a lease or overwrite a newer local edit's diagnostic.
      await admin.from("google_sync_outbox").update({ status: "needs_attention", last_error: (e instanceof Error ? e.message : "Replay failed").slice(0, 500) })
        .eq("id", row.id).eq("delivery_version", row.delivery_version).is("lease_token", null).throwOnError();
      attention += 1;
    }
  }
  return { synced, attention, skipped };
}
