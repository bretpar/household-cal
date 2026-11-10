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
    },
    { onConflict: "family_id,op_key" },
  );
  if (error) throw error;
}

async function markOutbox(
  admin: Admin,
  id: string,
  patch: { status: "synced" | "needs_attention"; last_error: string | null },
): Promise<void> {
  await admin
    .from("google_sync_outbox")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .throwOnError();
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

/** Stable key of the durable first-create intent for one event branch. */
export function createIntentKey(eventId: string, branchKey: string): string {
  return `create:${eventId}:${branchKey}`;
}

/** A fresh intent row is treated as owned by an in-flight request. */
const CREATE_INTENT_HOLD_MS = 5 * 60 * 1000;

/**
 * Database-backed claim on the first Google create of one event branch,
 * coordinating concurrent requests through the unique (family_id, op_key)
 * outbox key:
 * - "claimed": this request recorded the intent and may insert.
 * - "adopt":   an earlier attempt went stale mid-create; recover by looking up
 *   and adopting the remote event it may already have created.
 * - "held":    another in-flight request owns the intent; fail safe and do
 *   not insert.
 * A persistence failure throws before any Google insert can happen.
 */
export async function claimCreateIntent(
  admin: Admin,
  familyId: string,
  op: {
    eventId: string;
    branchKey: string;
    calendarSourceId: string;
    externalCalendarId: string | null;
  },
): Promise<"claimed" | "adopt" | "held"> {
  const opKey = createIntentKey(op.eventId, op.branchKey);
  const { data: existing } = await admin
    .from("google_sync_outbox")
    .select("id, status, updated_at")
    .eq("family_id", familyId)
    .eq("op_key", opKey)
    .maybeSingle();
  if (!existing) {
    const { error } = await admin.from("google_sync_outbox").insert({
      family_id: familyId,
      op_key: opKey,
      kind: "create",
      event_id: op.eventId,
      calendar_source_id: op.calendarSourceId,
      payload: { branch_key: op.branchKey, external_calendar_id: op.externalCalendarId },
      status: "pending",
    });
    if (error) {
      // Unique-key conflict: a concurrent request won the claim.
      if ((error as { code?: string }).code === "23505") return "held";
      throw error;
    }
    return "claimed";
  }
  if (existing.status === "synced") return "claimed";
  const ageMs = Date.now() - new Date(existing.updated_at as string).getTime();
  return ageMs < CREATE_INTENT_HOLD_MS ? "held" : "adopt";
}

/**
 * Replays pending and needs-attention operations for one household.
 *
 * - delete: retries the stored Google deletion payload; the local event may
 *   already be gone, which is exactly what the payload survives.
 * - create/update: re-pushes the local event when it still exists. A create
 *   whose link already carries a google_event_id is marked synced instead of
 *   re-inserting, so an uncertain create never becomes a duplicate.
 * - Anything that cannot be completed safely stays needs_attention with its
 *   retry metadata intact; a failed deletion is never replaced by a new event.
 */
export async function replayOutbox(
  admin: Admin,
  familyId: string,
): Promise<{ synced: number; attention: number; skipped: number }> {
  const { data: rows, error } = await admin
    .from("google_sync_outbox")
    .select("*")
    .eq("family_id", familyId)
    .in("status", ["pending", "needs_attention"])
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw error;

  let synced = 0;
  let attention = 0;
  let skipped = 0;
  for (const row of (rows ?? []) as OutboxRow[]) {
    await admin
      .from("google_sync_outbox")
      .update({ attempts: row.attempts + 1, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    try {
      if (row.kind === "delete") {
        const calendarId = (row.payload as { external_calendar_id?: string }).external_calendar_id;
        if (!calendarId || !row.google_event_id) {
          await markOutbox(admin, row.id, {
            status: "needs_attention",
            last_error: "Deletion payload is incomplete; kept for manual review.",
          });
          attention += 1;
          continue;
        }
        const sync = await import("@/lib/google/sync.server");
        // Retry against the explicitly recorded destination identity, not the
        // currently eligible source list: a source that fell out of eligibility
        // must not strand the deletion, and not_connected/timeout/unknown
        // outcomes come back as not-ok so the operation stays retryable.
        const outcome = await sync.pushEventDeletionResolved(admin, familyId, [
          { google_event_id: row.google_event_id, external_calendar_id: calendarId },
        ]);
        if (outcome.ok) {
          await markOutbox(admin, row.id, { status: "synced", last_error: null });
          synced += 1;
        } else {
          await markOutbox(admin, row.id, {
            status: "needs_attention",
            last_error: outcome.skipped ?? "Google deletion failed again.",
          });
          attention += 1;
        }
        continue;
      }

      // create / update / exclusion: replay through the normal push path.
      if (!row.event_id) {
        await markOutbox(admin, row.id, {
          status: "needs_attention",
          last_error: "Operation has no local event to replay.",
        });
        attention += 1;
        continue;
      }
      const { data: event } = await admin
        .from("events")
        .select("id")
        .eq("id", row.event_id)
        .eq("family_id", familyId)
        .maybeSingle();
      if (!event) {
        // The local event is gone; never re-create it from the outbox.
        await markOutbox(admin, row.id, {
          status: "needs_attention",
          last_error: "Local event was removed before this operation could be replayed.",
        });
        attention += 1;
        continue;
      }
      if (row.kind === "create" && row.google_event_id) {
        // A stored remote id is never trusted on faith: verify the exact
        // destination/event identity with Google and durably adopt it into the
        // event's sync links before this operation may count as synced.
        const calendarId = (row.payload as { external_calendar_id?: string }).external_calendar_id;
        const branchKey = (row.payload as { branch_key?: string }).branch_key ?? "";
        if (!calendarId || !row.calendar_source_id) {
          await markOutbox(admin, row.id, {
            status: "needs_attention",
            last_error: "Create payload is incomplete; kept for manual review.",
          });
          attention += 1;
          continue;
        }
        const sync = await import("@/lib/google/sync.server");
        const adopted = await sync.verifyAndAdoptRemoteEvent(
          admin,
          familyId,
          row.event_id,
          row.calendar_source_id,
          calendarId,
          row.google_event_id,
          branchKey,
        );
        if (adopted.ok) {
          await markOutbox(admin, row.id, { status: "synced", last_error: null });
          synced += 1;
        } else {
          await markOutbox(admin, row.id, {
            status: "needs_attention",
            last_error: adopted.skipped ?? "Remote create could not be verified.",
          });
          attention += 1;
        }
        continue;
      }
      const sync = await import("@/lib/google/sync.server");
      const outcome = await sync.pushEvent(admin, familyId, row.event_id);
      if (outcome.pushed && outcome.pushed > 0) {
        await markOutbox(admin, row.id, { status: "synced", last_error: null });
        synced += 1;
      } else {
        await markOutbox(admin, row.id, {
          status: "needs_attention",
          last_error: outcome.skipped ?? "Google push did not complete.",
        });
        attention += 1;
      }
    } catch (e) {
      await markOutbox(admin, row.id, {
        status: "needs_attention",
        last_error: (e instanceof Error ? e.message : "Replay failed").slice(0, 500),
      });
      attention += 1;
    }
  }
  return { synced, attention, skipped };
}
