import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  applyEventDelete,
  applyEventUpdate,
  asEventInput,
  assertEventEditable,
  defaultEventSource,
  assertWritableDestination,
  insertEvent,
  loadFamilyBundle,
  pushTargetsForUpdate,
  resolveMembership,
  resolveWritableFamily,
  resolveWritableFamilyForEvent,


  type Db,
  type FamilyBundle,
  type RecurrenceScope,
} from "@/lib/calendar-ops";
import type { AnyDb } from "@/lib/timesheets.server";

/**
 * Resolves the caller's household (claiming any pending invitation for their email).
 * Returns `family_id: null` for brand-new users, who are sent through onboarding.
 */
export const ensureFamilyMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { claimPendingInvitations } = await import("@/lib/household.server");
    const email = (context.claims as { email?: string }).email ?? null;
    const familyId = await resolveMembership(supabaseAdmin as unknown as Db, context.userId, () =>
      claimPendingInvitations(supabaseAdmin as never, context.userId, email),
    );
    // Role lets the client choose its navigation without waiting for the full
    // calendar bundle. Data access is still enforced by RLS everywhere.
    let role: string | null = null;
    if (familyId) {
      const { data } = await supabaseAdmin
        .from("family_users")
        .select("role")
        .eq("family_id", familyId)
        .eq("user_id", context.userId)
        .maybeSingle();
      role = (data?.role as string | undefined) ?? null;
    }
    return { family_id: familyId, role };
  });


export const getFamilyBundle = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data?: { from?: string; to?: string }) => ({
    from: typeof data?.from === "string" ? data.from : undefined,
    to: typeof data?.to === "string" ? data.to : undefined,
  }))
  .handler(async ({ data, context }): Promise<FamilyBundle> => {
    const { loadSecureCaregiverOccurrences } = await import("@/lib/caregiver-occurrences.server");
    const range = data.from && data.to ? { from: data.from, to: data.to } : undefined;
    return loadFamilyBundle(
      context.supabase as unknown as Db,
      context.userId,
      (familyId, sources, r) =>
        loadSecureCaregiverOccurrences(context.userId, familyId, sources, undefined, r),
      range,
    );
  });

export const createEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => asEventInput(data))
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as Db;
    const familyId = await resolveWritableFamily(db, context.userId);
    if (data.calendar_source_id) {
      await assertWritableDestination(db, familyId, data.calendar_source_id);
    }
    const sourceId = data.calendar_source_id ?? (await defaultEventSource(db, familyId));
    // New shifts can land on a caregiver's open period: hold submissions until reconciled.
    const jobId = await openReconcile(familyId, []);
    let id: string;
    try {
      id = await insertEvent(db, familyId, { ...data, calendar_source_id: sourceId });
    } catch (e) {
      await releaseReconcile(jobId);
      throw e;
    }
    const createdMembers = await shiftMembersOrNull(familyId, [id]);
    const timesheet_reconcile = createdMembers?.length === 0
      ? await releaseReconcile(jobId)
      : await finishReconcile(familyId, jobId, createdMembers ?? []);

    // Authoritative confirmation: the caller only reports success once the row
    // is readable back under the caller's own RLS context. Without this an
    // insert that is silently filtered out (policy change, wrong household)
    // could still resolve and produce a false "saved" state in the UI.
    const { data: saved, error: confirmError } = await db
      .from("events")
      .select("id, family_id, calendar_source_id, title, start_at, end_at, recurrence_rule, event_type")
      .eq("id", id)
      .eq("family_id", familyId)
      .maybeSingle();
    if (confirmError) {
      throw new Error(`Event save could not be confirmed: ${confirmError.message}`);
    }
    if (!saved?.id) {
      throw new Error("Event save could not be confirmed: no saved event was found after insert.");
    }
    if (data.recurrence_rule && !saved.recurrence_rule) {
      throw new Error("Event save could not be confirmed: the repeat pattern was not stored.");
    }

    // Google push only ever runs against a confirmed, stable OFC event id, and
    // never holds the user's save open: the wait is bounded and the push keeps
    // running in the background if Google is slow.
    const { pushWithDeadline } = await import("@/lib/google/push.server");
    const google_sync = await pushWithDeadline(familyId, [saved.id as string]);
    return { id: saved.id as string, google_sync, timesheet_reconcile };
  });


/** Caregivers assigned to these events; null when the lookup failed (caller must then treat the whole household as affected). */
async function shiftMembersOrNull(familyId: string, eventIds: string[]): Promise<string[] | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ts = await import("@/lib/timesheets.server");
    return await ts.shiftMemberIds(supabaseAdmin as unknown as AnyDb, familyId, eventIds);
  } catch (e) {
    console.error("shift member lookup failed", e);
    return null;
  }
}

/** Drops a hold that turned out to affect no caregiver. Left in place (and drained hourly) if this fails. */
async function releaseReconcile(jobId: string | null): Promise<"ok" | "pending"> {
  if (!jobId) return "ok";
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as unknown as AnyDb).from("timesheet_reconcile_jobs").delete().eq("id", jobId);
    if (error) throw error;
    return "ok";
  } catch (e) {
    console.error("could not release reconciliation hold", e);
    return "pending";
  }
}

/** Records a durable reconciliation intent before a shift-affecting change. */
async function openReconcile(familyId: string, memberIds: string[]): Promise<string | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ts = await import("@/lib/timesheets.server");
    return await ts.openReconcileJob(supabaseAdmin as unknown as AnyDb, familyId, memberIds);
  } catch (e) {
    // Fail closed: without a durable job the shift change must not be saved.
    console.error("could not record timesheet reconciliation job", e);
    throw new Error("Couldn't save this shift change right now. Please try again.");
  }
}

/**
 * Reconciles every existing editable timesheet of the affected caregivers in
 * one transaction. On failure the job stays pending (retried hourly) and the
 * caller reports "pending" instead of silent success.
 */
async function finishReconcile(familyId: string, jobId: string | null, memberIds: string[]): Promise<"ok" | "pending"> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ts = await import("@/lib/timesheets.server");
    return await ts.runReconcileJob(supabaseAdmin as unknown as AnyDb, familyId, jobId, memberIds);
  } catch (e) {
    console.error("timesheet reconciliation failed", e);
    return "pending";
  }
}

export const updateEventFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      event_id: string;
      occurrence_day: string;
      scope: RecurrenceScope;
      input: unknown;
    }) => ({ ...data, input: asEventInput(data.input) }),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as Db;
    const familyId = await resolveWritableFamilyForEvent(db, context.userId, data.event_id);
    await assertEventEditable(db, data.event_id);
    // Capture caregivers before the update so an unassigned caregiver's sheet is reconciled too.
    const priorMembers = await shiftMembersOrNull(familyId, [data.event_id]);
    // Unknown or none yet: hold the whole household, since the edit may add a caregiver.
    const jobId = await openReconcile(familyId, priorMembers?.length ? priorMembers : []);
    let created: string | null;
    try {
      created = await applyEventUpdate(
        db,
        data.event_id,
        data.occurrence_day,
        data.scope,
        data.input,
      );
    } catch (e) {
      // Release only when the atomic split certainly rolled back; any other
      // failure may have partially written, so the hold stays for hourly retry.
      if ((e as { splitRolledBack?: unknown })?.splitRolledBack === true) await releaseReconcile(jobId);
      throw e;
    }
    const afterMembers = await shiftMembersOrNull(familyId, [data.event_id, ...(created ? [created] : [])]);
    const timesheet_reconcile = await finishReconcile(
      familyId,
      jobId,
      priorMembers === null || afterMembers === null ? [] : [...priorMembers, ...afterMembers],
    );
    // assigning family members clears the "needs family assignment" badge
    if (data.input.member_ids.length > 0) {
      await db.from("events").update({ needs_family_assignment: false }).eq("id", data.event_id);
    }
    // Local persistence is done at this point, so the edit is authoritative and
    // the UI may return immediately. A "This event only" time edit touches two
    // rows (the recurring parent gains an EXDATE, plus the detached one-off);
    // both are pushed together. The wait is bounded like create/delete, but the
    // pushes are not cancelled — they are link-keyed and swallow their own
    // errors, and reconcile repairs anything a cut-off worker dropped, so no
    // Google branch is left without its event_sync_links row for long.
    const { pushWithDeadline } = await import("@/lib/google/push.server");
    const google_sync = await pushWithDeadline(
      familyId,
      pushTargetsForUpdate(data.event_id, created),
    );

    return { ok: true as const, google_sync, timesheet_reconcile };
  });

export const deleteEventFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { event_id: string; occurrence_day: string; scope: RecurrenceScope }) => data,
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as Db;
    const familyId = await resolveWritableFamilyForEvent(db, context.userId, data.event_id);
    await assertEventEditable(db, data.event_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sync = await import("@/lib/google/sync.server");

    const wholeEventGone = data.scope === "series";
    const links = wholeEventGone ? await sync.linksForEvent(supabaseAdmin, data.event_id) : [];

    // Capture assigned caregivers before the delete removes the shift rows.
    const shiftMembers = await shiftMembersOrNull(familyId, [data.event_id]);
    const jobId = await openReconcile(familyId, shiftMembers ?? []);

    await applyEventDelete(db, data.event_id, data.occurrence_day, data.scope);
    const timesheet_reconcile = shiftMembers?.length === 0
      ? await releaseReconcile(jobId)
      : await finishReconcile(familyId, jobId, shiftMembers ?? []);

    const { pushWithDeadline, PUSH_DEADLINE_MS } = await import("@/lib/google/push.server");
    const google_sync = wholeEventGone
      ? await Promise.race([
          sync.pushEventDeletion(supabaseAdmin, familyId, links).then((outcome) =>
            outcome.ok ? "synced" as const
              : outcome.skipped === "not_linked" || outcome.skipped === "not_connected"
                ? "unlinked" as const : "failed" as const,
          ).catch(() => "failed" as const),
          new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), PUSH_DEADLINE_MS)),
        ])
      : await pushWithDeadline(familyId, [data.event_id]);
    return { ok: true, timesheet_reconcile, google_sync };
  });

/**
 * Per-event outbound sync state, used to move a saved event from "Syncing…" to
 * "Synced" without waiting for inbound reconciliation. "Synced" means the push
 * succeeded *and* its event_sync_links row exists.
 */
export const getEventSyncState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { event_id: string }) => ({ event_id: String(data.event_id) }))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ state: "synced" | "pending" | "failed" | "unlinked"; error: string | null }> => {
      const db = context.supabase as unknown as Db;
      // RLS-scoped read first: household isolation is enforced before any
      // admin-side link lookup happens.
      const { data: event } = await (db as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { id: string; family_id: string } | null }> };
          };
        };
      })
        .from("events")
        .select("id, family_id")
        .eq("id", data.event_id)
        .maybeSingle();
      // The row must still be there. A newly saved event that has vanished is a
      // real failure, never a quiet success.
      if (!event) {
        return {
          state: "failed",
          error: "The saved event is no longer on the calendar. Please try again.",
        };
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: links } = await supabaseAdmin
        .from("event_sync_links")
        .select("google_event_id, sync_error")
        .eq("event_id", data.event_id)
        .eq("family_id", event.family_id);
      const rows = (links ?? []) as { google_event_id: string | null; sync_error: string | null }[];
      const failure = rows.find((row) => row.sync_error)?.sync_error ?? null;
      if (failure) return { state: "failed", error: failure };
      if (rows.some((row) => row.google_event_id)) return { state: "synced", error: null };
      return { state: "pending", error: null };
    },
  );


