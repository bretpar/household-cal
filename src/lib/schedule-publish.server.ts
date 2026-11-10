/**
 * Server-side execution service for publishing a private Babysitter Schedule
 * Builder draft. Owner-authorized callers only (the server functions gate
 * first); every operation is claimed and applied by the atomic
 * apply_schedule_publish_op RPC, so event, participants, caregiver assignment
 * and journal mapping commit or roll back together.
 *
 * Publishing is disabled for everyone while Phase 3A is under review: the
 * execution gate below rejects all mutation, including direct server-function
 * calls. Planning/preview stays available. Google delivery is deliberately
 * deferred — no Google writes happen here.
 */
import {
  loadFamilyBundle,
  type Db,
} from "@/lib/calendar-ops";
import {
  finishReconcile,
  openReconcile,
  releaseReconcile,
  shiftMembersOrNull,
} from "@/lib/calendar.functions";
import { draftSchema, monthDates, type ProposedShift } from "@/lib/schedule-builder";
import { planPublish, type PublishPlan } from "@/lib/schedule-publish";
import type { Assignment } from "@/lib/schedule-builder";

/** Phase 3A execution lock: no user or direct caller can publish yet. */
export const PUBLISH_EXECUTION_ENABLED = false;

export interface PublishExecutionResult {
  runId: string;
  applied: number;
  skipped: number;
  needsAttention: number;
  conflicts: { shiftId: string; reason: string }[];
  timesheetReconcile: "ok" | "pending";
}

/**
 * Loads the authoritative current plan for a draft. Shared by the read-only
 * preview and the executor so both classify against the same calendar state.
 */
export async function loadPublishPlan(
  db: Db,
  userId: string,
  familyId: string,
  month: string,
): Promise<{
  draft: { id: string; revision: number; content: ReturnType<typeof draftSchema.parse> };
  plan: PublishPlan;
  timeZone: string;
  babysitterSourceId: string | null;
  /** Reviewed calendar version per referenced event, revalidated at execution. */
  eventVersions: Record<string, string>;
}> {
  const dates = monthDates(month);
  const [bundle, family, draft, lineage] = await Promise.all([
    loadFamilyBundle(db, userId, undefined, {
      from: `${month}-01`,
      to: dates.at(-1) ?? `${month}-01`,
    }),
    db.from("families").select("timezone, babysitter_calendar_source_id").eq("id", familyId).single(),
    db.from("babysitter_schedule_drafts").select("*").eq("family_id", familyId).eq("month", `${month}-01`).maybeSingle(),
    db.from("events").select("id,split_from_event_id,split_from_date").eq("family_id", familyId).not("split_from_event_id", "is", null),
  ]);
  if (bundle.family?.id !== familyId || !family.data) {
    throw new Error("Household changed. Reopen the schedule builder.");
  }
  if (!draft.data) throw new Error("There is no saved draft for this month.");
  const content = draftSchema.parse(draft.data.content);
  const { currentMonthOccurrences } = await import("@/lib/schedule-publish");
  const existing = currentMonthOccurrences(bundle.events, month, family.data.timezone, Object.fromEntries(
    (lineage.data ?? []).map((e: { id: string; split_from_event_id: string | null; split_from_date: string | null }) => [
      e.id,
      { split_from_event_id: e.split_from_event_id, split_from_date: e.split_from_date },
    ]),
  ));
  const plan = planPublish(content, existing);

  // Record the reviewed calendar version for every referenced event.
  const referencedIds = [...new Set(plan.ops.flatMap((op) => (op.eventId ? [op.eventId] : [])))];
  const eventVersions: Record<string, string> = {};
  if (referencedIds.length > 0) {
    const { data: versions } = await db
      .from("events")
      .select("id, updated_at")
      .eq("family_id", familyId)
      .in("id", referencedIds);
    for (const row of versions ?? []) {
      eventVersions[row.id as string] = row.updated_at as string;
    }
  }

  return {
    draft: { id: draft.data.id as string, revision: draft.data.revision as number, content },
    plan,
    timeZone: family.data.timezone as string,
    babysitterSourceId: (family.data.babysitter_calendar_source_id as string | null) ?? null,
    eventVersions,
  };
}

/**
 * Applies a reviewed draft through the atomic publish RPC. `reviewedShiftIds`
 * is the explicit reviewed intent: operations that modify an existing
 * occurrence run only when their shift id is present. `reviewedEventVersions`
 * is the immutable calendar snapshot from the reviewed preview: every update
 * operation must carry the exact event version the Owner saw, and that
 * version — never a freshly loaded substitute — is revalidated
 * transactionally under a row lock inside the RPC. Creates never touch
 * existing occurrences and need no review. Unreviewed and conflicting
 * operations are left pending in the journal for a later run.
 */
export async function executePublish(
  db: Db,
  userId: string,
  familyId: string,
  month: string,
  expectedRevision: number,
  reviewedShiftIds: string[],
  reviewedEventVersions: Record<string, string>,
): Promise<PublishExecutionResult> {
  const { draft, plan, timeZone, babysitterSourceId } = await loadPublishPlan(
    db,
    userId,
    familyId,
    month,
  );
  if (draft.revision !== expectedRevision) {
    throw new Error("This draft changed since you reviewed it. Reload the preview before publishing.");
  }

  const updateEventIds = plan.ops.flatMap((op) =>
    op.kind === "update" && op.eventId ? [op.eventId] : [],
  );
  // Capture previous caregivers before any change so an unassigned caregiver's
  // sheet is reconciled too. A failed lookup is not an empty set: abort before
  // anything is written so no change ever goes unreconciled.
  const priorMembers = updateEventIds.length > 0 ? await shiftMembersOrNull(familyId, updateEventIds) : [];
  if (priorMembers === null) {
    throw new Error("Couldn't confirm the current caregiver assignments. Nothing was published — please try again.");
  }

  const { data: run, error: runError } = await db
    .from("babysitter_schedule_publish_runs")
    .insert({
      family_id: familyId,
      draft_id: draft.id,
      month: `${month}-01`,
      draft_revision: draft.revision,
      status: "applying",
      started_by: userId,
    })
    .select("id")
    .single();
  if (runError || !run) throw new Error("The publish run could not be recorded.");
  const runId = run.id as string;

  const reviewed = new Set(reviewedShiftIds);
  const shiftById = new Map(draft.content.shifts.map((s) => [s.id, s]));
  const result: PublishExecutionResult = {
    runId,
    applied: 0,
    skipped: 0,
    needsAttention: 0,
    conflicts: [],
    timesheetReconcile: "ok",
  };
  const touchedEventIds: string[] = [];
  const jobId = await openReconcile(familyId, priorMembers);

  try {
    for (const op of plan.ops) {
      const shift = shiftById.get(op.shiftId);
      if (!shift || op.kind === "unchanged") {
        result.skipped += 1;
        continue;
      }
      if (op.kind === "conflict") {
        result.conflicts.push({ shiftId: op.shiftId, reason: op.reason ?? "Conflict" });
        result.needsAttention += 1;
        continue;
      }
      if (op.requiresReview && !reviewed.has(op.shiftId)) {
        result.skipped += 1;
        continue;
      }

      // Bind execution to the exact reviewed calendar version. A missing
      // version means the preview predates this op — reject, never substitute
      // a freshly loaded version.
      if (op.kind === "update" && op.eventId && !reviewedEventVersions[op.eventId]) {
        result.conflicts.push({
          shiftId: op.shiftId,
          reason: "This change was not part of the reviewed preview. Reload the preview before publishing.",
        });
        result.needsAttention += 1;
        continue;
      }

      const opPayload = {
        kind: op.kind,
        eventId: op.eventId,
        occurrenceDate: op.occurrenceDate,
        expectedUpdatedAt: op.eventId ? (reviewedEventVersions[op.eventId] ?? null) : null,
      };
      const opKey = `${draft.id}:${op.shiftId}:${draft.revision}`;
      try {
        // The atomic RPC is executable only by the service role, so it runs
        // through the privileged server client — never the caller's session.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc("apply_schedule_publish_op", {
          _caller: userId,
          _family: familyId,
          _draft: draft.id,
          _revision: draft.revision,
          _run: runId,
          _shift: JSON.parse(JSON.stringify(shift)),
          _op: opPayload,
          // Null is valid here (no Babysitter calendar yet): the RPC then
          // skips caregiver assignment. The generated types only allow string.
          _source: babysitterSourceId as string,
          _timezone: timeZone,
        });
        if (rpcError) throw rpcError;
        const outcome = rpcResult as { outcome?: string; event_id?: string } | null;
        if (outcome?.event_id) touchedEventIds.push(outcome.event_id);
        if (outcome?.outcome === "already_applied") result.skipped += 1;
        else result.applied += 1;
      } catch (e) {
        // The outcome is uncertain: the RPC may have committed while the
        // response was lost. Re-read the durable journal before recording
        // anything — an already-applied operation keeps its applied state and
        // mapped event, and is never downgraded to needs_attention.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: existingOp } = await supabaseAdmin
          .from("babysitter_schedule_publish_ops")
          .select("status, event_id")
          .eq("family_id", familyId)
          .eq("op_key", opKey)
          .maybeSingle();
        if (existingOp?.status === "applied") {
          if (existingOp.event_id) touchedEventIds.push(existingOp.event_id as string);
          result.applied += 1;
          continue;
        }
        // No applied row: fail closed. Insert a recoverable failure marker
        // without overwriting any existing journal row.
        await supabaseAdmin.from("babysitter_schedule_publish_ops").upsert(
          {
            family_id: familyId,
            run_id: runId,
            draft_id: draft.id,
            draft_revision: draft.revision,
            op_key: opKey,
            draft_shift_id: op.shiftId,
            kind: op.kind,
            status: "needs_attention",
            last_error: (e instanceof Error ? e.message : "Publish step failed").slice(0, 500),
            payload: JSON.parse(JSON.stringify({ shift, op: opPayload })),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "family_id,op_key", ignoreDuplicates: true },
        );
        result.needsAttention += 1;
      }
    }

    // Reconcile both previous and new caregivers. A failed post-change lookup
    // is not an empty set: keep the reconciliation hold pending (drained by
    // the hourly retry) and report a recoverable failure instead of releasing
    // or finishing it.
    const afterMembers = await shiftMembersOrNull(familyId, touchedEventIds);
    if (afterMembers === null) {
      result.timesheetReconcile = "pending";
      result.needsAttention += 1;
    } else {
      const reconcileMembers = [...new Set([...priorMembers, ...afterMembers])];
      result.timesheetReconcile = reconcileMembers.length === 0
        ? await releaseReconcile(jobId)
        : await finishReconcile(familyId, jobId, reconcileMembers);
    }

    await db
      .from("babysitter_schedule_publish_runs")
      .update({
        status: result.needsAttention > 0 ? "failed" : "applied",
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
    return result;
  } catch (e) {
    await releaseReconcile(jobId);
    await db
      .from("babysitter_schedule_publish_runs")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", runId);
    throw e;
  }
}

export type { Assignment, ProposedShift };
