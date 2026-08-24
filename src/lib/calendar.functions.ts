import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  applyEventDelete,
  applyEventUpdate,
  asEventInput,
  defaultEventSource,
  insertEvent,
  loadFamilyBundle,
  resolveMembership,
  resolveWritableFamily,
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
    const { pushToGoogle } = await import("@/lib/google/push.server");
    await pushToGoogle(familyId, id);
    return { id };
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
    const familyId = await resolveWritableFamily(db, context.userId);
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
    const { pushToGoogle } = await import("@/lib/google/push.server");
    await pushToGoogle(familyId, data.event_id);
    if (created && created !== data.event_id) await pushToGoogle(familyId, created);
    return { ok: true };
  });

export const deleteEventFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { event_id: string; occurrence_day: string; scope: RecurrenceScope }) => data,
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as Db;
    const familyId = await resolveWritableFamily(db, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sync = await import("@/lib/google/sync.server");

    const wholeEventGone = data.scope === "series";
    const links = wholeEventGone ? await sync.linksForEvent(supabaseAdmin, data.event_id) : [];

    await applyEventDelete(db, data.event_id, data.occurrence_day, data.scope);

    if (wholeEventGone) await sync.pushEventDeletion(supabaseAdmin, familyId, links);
    else await sync.pushEvent(supabaseAdmin, familyId, data.event_id);
    return { ok: true };
  });

