/**
 * Server-side execution service for publishing a private Babysitter Schedule
 * Builder draft. Owner-authorized callers only (the server functions gate
 * first); every write is idempotent on a per-draft-shift operation key, and
 * the operation journal survives interruption for recovery.
 *
 * Local event, member and caregiver-assignment writes reuse the existing
 * atomic calendar helpers and Timesheet reconciliation holds — no separate
 * calendar engine. Google pushes keep their bounded-wait semantics: a wait
 * that expires leaves the operation "pending", never "synced".
 */
import { fromZonedTime } from "date-fns-tz";
import {
  applyEventDelete,
  applyEventUpdate,
  insertEvent,
  loadFamilyBundle,
  type Db,
  type EventInput,
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

export interface PublishExecutionResult {
  runId: string;
  applied: number;
  skipped: number;
  needsAttention: number;
  conflicts: { shiftId: string; reason: string }[];
  google: "synced" | "pending" | "failed" | "unlinked";
  timesheetReconcile: "ok" | "pending";
}

function shiftToEventInput(
  shift: ProposedShift,
  timeZone: string,
  sourceId: string | null,
): EventInput {
  const startAt = fromZonedTime(`${shift.date}T${shift.start}:00`, timeZone);
  const endAt = fromZonedTime(`${shift.date}T${shift.end}:00`, timeZone);
  return {
    calendar_source_id: sourceId,
    title: shift.title,
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString(),
    all_day: false,
    location: null,
    notes: null,
    event_type: "childcare",
    recurrence_rule: null,
    member_ids: [],
    babysitter_assignment: shift.assignment as EventInput["babysitter_assignment"],
  };
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
  return {
    draft: { id: draft.data.id as string, revision: draft.data.revision as number, content },
    plan: planPublish(content, existing),
    timeZone: family.data.timezone as string,
    babysitterSourceId: (family.data.babysitter_calendar_source_id as string | null) ?? null,
  };
}

/**
 * Applies a planned draft. `reviewedShiftIds` is the explicit reviewed intent:
 * operations that modify or remove an existing occurrence run only when their
 * shift id is present. Creates never touch existing occurrences and need no
 * review. Unreviewed and conflicting operations are left pending in the
 * journal for a later run.
 */
export async function executePublish(
  db: Db,
  userId: string,
  familyId: string,
  month: string,
  expectedRevision: number,
  reviewedShiftIds: string[],
): Promise<PublishExecutionResult> {
  const { draft, plan, timeZone, babysitterSourceId } = await loadPublishPlan(db, userId, familyId, month);
  if (draft.revision !== expectedRevision) {
    throw new Error("This draft changed since you reviewed it. Reload the preview before publishing.");
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
    google: "unlinked",
    timesheetReconcile: "ok",
  };
  const touchedEventIds: string[] = [];
  const affectedMembers = new Set<string>();
  const jobId = await openReconcile(familyId, []);

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

      // Idempotency: one journal row per draft shift per revision. A repeated
      // or concurrent request finds the row and does not re-apply.
      const opKey = `${draft.id}:${op.shiftId}:${draft.revision}`;
      const { data: existingOp } = await db
        .from("babysitter_schedule_publish_ops")
        .select("id, status, event_id")
        .eq("family_id", familyId)
        .eq("op_key", opKey)
        .maybeSingle();
      if (existingOp?.status === "applied") {
        result.skipped += 1;
        if (existingOp.event_id) touchedEventIds.push(existingOp.event_id as string);
        continue;
      }

      const payload = JSON.parse(JSON.stringify({ shift, op }));
      if (!existingOp) {
        const { error: insError } = await db.from("babysitter_schedule_publish_ops").insert({
          family_id: familyId,
          run_id: runId,
          draft_id: draft.id,
          draft_revision: draft.revision,
          op_key: opKey,
          draft_shift_id: op.shiftId,
          kind: op.kind,
          status: "pending",
          payload,
        });
        if (insError) throw insError;
      }

      try {
        let eventId: string | null = (existingOp?.event_id as string | null) ?? null;
        if (op.kind === "create") {
          if (!eventId) {
            eventId = await insertEvent(db, familyId, shiftToEventInput(shift, timeZone, babysitterSourceId));
          }
        } else if (op.kind === "update" && op.eventId && op.occurrenceDate) {
          const created = await applyEventUpdate(
            db,
            op.eventId,
            op.occurrenceDate,
            "this",
            shiftToEventInput(shift, timeZone, babysitterSourceId),
          );
          eventId = created ?? op.eventId;
        } else if (op.kind === "exclude" && op.eventId && op.occurrenceDate) {
          await applyEventDelete(db, op.eventId, op.occurrenceDate, "this");
          eventId = op.eventId;
        } else {
          throw new Error("Unsupported publish operation.");
        }
        if (eventId) touchedEventIds.push(eventId);
        if (shift.assignment.kind === "caregiver") affectedMembers.add(shift.assignment.family_member_id);
        await db
          .from("babysitter_schedule_publish_ops")
          .update({ status: "applied", event_id: eventId, run_id: runId, updated_at: new Date().toISOString() })
          .eq("family_id", familyId)
          .eq("op_key", opKey)
          .throwOnError();
        result.applied += 1;
      } catch (e) {
        await db
          .from("babysitter_schedule_publish_ops")
          .update({
            status: "needs_attention",
            last_error: (e instanceof Error ? e.message : "Publish step failed").slice(0, 500),
            run_id: runId,
            updated_at: new Date().toISOString(),
          })
          .eq("family_id", familyId)
          .eq("op_key", opKey);
        result.needsAttention += 1;
      }
    }

    const members = await shiftMembersOrNull(familyId, touchedEventIds);
    const reconcileMembers = members ?? [...affectedMembers];
    result.timesheetReconcile = reconcileMembers.length === 0 && members?.length === 0
      ? await releaseReconcile(jobId)
      : await finishReconcile(familyId, jobId, reconcileMembers);

    if (touchedEventIds.length > 0) {
      const { pushWithDeadline } = await import("@/lib/google/push.server");
      result.google = await pushWithDeadline(familyId, [...new Set(touchedEventIds)]);
      // A bounded wait that expires is "pending", never "synced"; per-op
      // Google state stays queryable from the journal.
      const googleStatus = result.google === "synced" ? "synced"
        : result.google === "unlinked" ? "not_applicable" : "pending";
      await db
        .from("babysitter_schedule_publish_ops")
        .update({ google_status: googleStatus, updated_at: new Date().toISOString() })
        .eq("family_id", familyId)
        .eq("run_id", runId)
        .eq("status", "applied");
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

export type { Assignment };
