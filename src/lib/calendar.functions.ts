import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  applyEventDelete,
  applyEventUpdate,
  asEventInput,
  defaultEventSource,
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
    return { family_id: familyId };
  });


export const getFamilyBundle = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({ context }): Promise<FamilyBundle> =>
      loadFamilyBundle(context.supabase as unknown as Db, context.userId),
  );

export const createEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => asEventInput(data))
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as Db;
    const familyId = await resolveWritableFamily(db, context.userId);
    const sourceId = data.calendar_source_id ?? (await defaultEventSource(db, familyId));
    const id = await insertEvent(db, familyId, { ...data, calendar_source_id: sourceId });

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
    return { id: saved.id as string, google_sync };
  });


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
    const created = await applyEventUpdate(
      db,
      data.event_id,
      data.occurrence_day,
      data.scope,
      data.input,
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

    return { ok: true as const, google_sync };
  });

export const deleteEventFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { event_id: string; occurrence_day: string; scope: RecurrenceScope }) => data,
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as Db;
    const familyId = await resolveWritableFamilyForEvent(db, context.userId, data.event_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sync = await import("@/lib/google/sync.server");

    const wholeEventGone = data.scope === "series";
    const links = wholeEventGone ? await sync.linksForEvent(supabaseAdmin, data.event_id) : [];

    await applyEventDelete(db, data.event_id, data.occurrence_day, data.scope);

    await Promise.race([
      wholeEventGone
        ? sync.pushEventDeletion(supabaseAdmin, familyId, links)
        : sync.pushEvent(supabaseAdmin, familyId, data.event_id),
      new Promise<void>((resolve) => setTimeout(resolve, 2500)),
    ]);
    return { ok: true };
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
      if (!event) return { state: "unlinked", error: null };

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


