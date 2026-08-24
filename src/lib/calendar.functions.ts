import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  applyEventDelete,
  applyEventUpdate,
  asEventInput,
  defaultEventSource,
  ensureMembership,
  insertEvent,
  loadFamilyBundle,
  resolveWritableFamily,
  type Db,
  type FamilyBundle,
  type RecurrenceScope,
} from "@/lib/calendar-ops";

export const ensureFamilyMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { claimPendingInvitations } = await import("@/lib/household.server");
    const email = (context.claims as { email?: string }).email ?? null;
    const familyId = await ensureMembership(supabaseAdmin as unknown as Db, context.userId, () =>
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
    await applyEventUpdate(
      context.supabase as unknown as Db,
      data.event_id,
      data.occurrence_day,
      data.scope,
      data.input,
    );
    return { ok: true };
  });

export const deleteEventFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { event_id: string; occurrence_day: string; scope: RecurrenceScope }) => data,
  )
  .handler(async ({ data, context }) => {
    await applyEventDelete(
      context.supabase as unknown as Db,
      data.event_id,
      data.occurrence_day,
      data.scope,
    );
    return { ok: true };
  });
