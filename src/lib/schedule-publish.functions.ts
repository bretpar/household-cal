/**
 * Typed, owner-gated APIs for the future Review & Publish flow.
 *
 * Nothing in the current UI calls these; they are the integration boundary for
 * Phase 3B. Every function re-verifies household ownership and all calendar
 * writes go through the existing atomic helpers and reconciliation holds.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { monthSchema } from "@/lib/schedule-builder";
import type { supabase } from "@/integrations/supabase/client";
import type { Db } from "@/lib/calendar-ops";

type Client = typeof supabase;

async function owner(db: Client, userId: string, familyId: string) {
  const { data, error } = await db
    .from("family_users")
    .select("role")
    .eq("family_id", familyId)
    .eq("user_id", userId)
    .single();
  if (error || (data?.role !== "owner" && data?.role !== "editor")) {
    throw new Error("Only a household Owner or Editor can publish schedule drafts.");
  }
}

const scope = z.object({ familyId: z.uuid(), month: monthSchema });

/** Read-only authoritative preview: classifies the saved draft against live calendar state. */
export const planSchedulePublish = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => scope.parse(data))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    await owner(db, context.userId, data.familyId);
    const { loadPublishPlan } = await import("@/lib/schedule-publish.server");
    const { draft, plan, eventVersions } = await loadPublishPlan(
      db as unknown as Db,
      context.userId,
      data.familyId,
      data.month,
    );
    // Persist a service-only snapshot so echoed client versions cannot be
    // manipulated into authorizing an event version never reviewed here.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: preview, error } = await supabaseAdmin
      .from("babysitter_schedule_publish_previews")
      .insert({ family_id: data.familyId, draft_id: draft.id, draft_revision: draft.revision,
        created_by: context.userId, plan: JSON.parse(JSON.stringify(plan)), event_versions: eventVersions })
      .select("id").single();
    if (error || !preview) throw new Error("The publish preview could not be recorded. Try again.");
    return { revision: draft.revision, plan, eventVersions, previewId: preview.id };
  });

/** Whether the verified Owner may publish for this household (QA gate). */
export const getSchedulePublishGate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ familyId: z.uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await owner(context.supabase, context.userId, data.familyId);
    const { publishGateOpen } = await import("@/lib/schedule-publish.server");
    return { enabled: await publishGateOpen(data.familyId, context.userId) };
  });

/**
 * Applies a reviewed draft. Idempotent per draft shift and revision; stale
 * revisions are rejected before anything is written. Not reachable from the
 * current UI.
 */
export const executeSchedulePublish = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    scope
      .extend({
        revision: z.number().int().positive(),
        previewId: z.uuid(),
        reviewedShiftIds: z.array(z.uuid()).max(500),
        // Immutable reviewed calendar versions echoed back from the preview;
        // execution rejects any update op whose version is missing or stale.
        reviewedEventVersions: z.record(z.uuid(), z.string()),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    await owner(db, context.userId, data.familyId);
    const { executePublish, publishGateOpen } = await import("@/lib/schedule-publish.server");
    // Server-enforced QA gate: rejects every non-allowlisted household/owner,
    // including direct server-function callers.
    if (!(await publishGateOpen(data.familyId, context.userId))) {
      throw new Error("Schedule publishing is not available for this household yet.");
    }
    return executePublish(
      db as unknown as Db,
      context.userId,
      data.familyId,
      data.month,
      data.revision,
      data.reviewedShiftIds,
      data.reviewedEventVersions,
      data.previewId,
    );
  });

/**
 * Replays pending/failed Google operations for the household from the durable
 * outbox. Owner-authorized; safe to call repeatedly.
 */
export const replayGoogleSyncOutbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ familyId: z.uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await owner(context.supabase, context.userId, data.familyId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { replayOutbox } = await import("@/lib/google/outbox.server");
    return replayOutbox(supabaseAdmin, data.familyId);
  });
