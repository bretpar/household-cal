/**
 * Server-side execution service for publishing a private Babysitter Schedule
 * Builder draft. Owner-authorized callers only (the server functions gate
 * first); every operation is claimed and applied by the atomic
 * apply_schedule_publish_op RPC, so event, participants, caregiver assignment
 * and journal mapping commit or roll back together.
 *
 * Publishing is off for everyone except households allowlisted in the
 * service-only QA gate (publishGateOpen). Google delivery goes through the
 * durable outbox queued transactionally by event triggers.
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

/**
 * Controlled QA gate (default off). Publishing is allowed only when the
 * service-only schedule_publish_qa_gates table has an enabled row for this
 * exact household AND verified owner user id. No env, client flag or email
 * can enable it; every other household is rejected server-side.
 */
export async function publishGateOpen(familyId: string, userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("schedule_publish_qa_gates").select("enabled")
    .eq("family_id", familyId).eq("owner_user_id", userId).maybeSingle();
  return !error && data?.enabled === true;
}

export type GoogleDeliveryStatus = "not_applicable" | "pending" | "synced" | "needs_attention";

export interface PublishExecutionResult {
  runId: string;
  applied: number;
  skipped: number;
  needsAttention: number;
  conflicts: { shiftId: string; reason: string }[];
  timesheetReconcile: "ok" | "pending";
  /** Local OFC save is complete; Google delivery is reported separately. */
  google: { status: GoogleDeliveryStatus; pending: number; synced: number; needsAttention: number };
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
  // Match the builder: only Babysitter-calendar events are existing shifts.
  const sitterSource = (family.data.babysitter_calendar_source_id as string | null) ?? null;
  const sitterEvents = sitterSource ? bundle.events.filter((e) => e.calendar_source_id === sitterSource) : [];
  const existing = currentMonthOccurrences(sitterEvents, month, family.data.timezone, Object.fromEntries(
    (lineage.data ?? []).map((e: { id: string; split_from_event_id: string | null; split_from_date: string | null }) => [
      e.id,
      { split_from_event_id: e.split_from_event_id, split_from_date: e.split_from_date },
    ]),
  ));
  const { data: mappings, error: mappingError } = await db
    .from("babysitter_schedule_publish_ops")
    .select("draft_shift_id,event_id,draft_revision")
    .eq("family_id", familyId).eq("draft_id", draft.data.id)
    .eq("status", "applied").not("event_id", "is", null)
    .order("draft_revision", { ascending: false });
  if (mappingError) throw new Error("Couldn't confirm previously published proposals. Reload the preview.");
  const mappedEvents: Record<string, string> = {};
  for (const row of mappings ?? []) {
    if (row.event_id && !mappedEvents[row.draft_shift_id]) mappedEvents[row.draft_shift_id] = row.event_id;
  }
  const plan = planPublish(content, existing, mappedEvents);

  // Reviewed versions come from the SAME row read that produced the details,
  // participants and shift assignment: the bundle loads each event with its
  // embedded event_members/babysitter_shifts in one PostgREST statement, i.e.
  // one Postgres snapshot. No separate, unfenced version read.
  const eventVersions = snapshotEventVersions(
    plan,
    sitterEvents,
    lineage.data ?? [],
  );
  // Bind each reviewed original to the exact version used for concurrency checks.
  for (const op of plan.ops) {
    if (op.original) op.original = { ...op.original, eventVersion: eventVersions[op.original.eventId] ?? null };
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
  previewId: string,
): Promise<PublishExecutionResult> {
  const { draft, timeZone, babysitterSourceId } = await loadPublishPlan(
    db,
    userId,
    familyId,
    month,
  );
  if (draft.revision !== expectedRevision) {
    throw new Error("This draft changed since you reviewed it. Reload the preview before publishing.");
  }

  // Only the server can write these snapshots. Client-echoed versions cannot
  // replace the immutable reviewed identity/version with a newer one.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: preview, error: previewError } = await supabaseAdmin
    .from("babysitter_schedule_publish_previews").select("plan,event_versions")
    .eq("id", previewId).eq("family_id", familyId).eq("draft_id", draft.id)
    .eq("draft_revision", expectedRevision).eq("created_by", userId).single();
  if (previewError || !preview) throw new Error("Reload the publish preview before publishing.");
  const plan = preview.plan as unknown as PublishPlan;
  const immutableVersions = preview.event_versions as Record<string, string>;

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
    google: { status: "not_applicable", pending: 0, synced: 0, needsAttention: 0 },
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
      if (op.kind === "update" && (!op.eventId || !immutableVersions[op.eventId]
        || reviewedEventVersions[op.eventId] !== immutableVersions[op.eventId])) {
        result.conflicts.push({
          shiftId: op.shiftId,
          reason: "This change was not part of the reviewed preview. Reload the preview before publishing.",
        });
        result.needsAttention += 1;
        continue;
      }

      const opPayload = {
        previewId,
        kind: op.kind,
        eventId: op.eventId,
        occurrenceDate: op.occurrenceDate,
        expectedUpdatedAt: op.eventId ? (immutableVersions[op.eventId] ?? null) : null,
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
    result.google = await googleDeliveryStatus(familyId, touchedEventIds);
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

/**
 * Drains the household's durable outbox once (intents were queued
 * transactionally by the event triggers) and reports delivery for the
 * published events. Never throws: the local save already committed.
 */
async function googleDeliveryStatus(familyId: string, eventIds: string[]): Promise<PublishExecutionResult["google"]> {
  const out: PublishExecutionResult["google"] = { status: "not_applicable", pending: 0, synced: 0, needsAttention: 0 };
  if (eventIds.length === 0) return out;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  try {
    const { replayOutbox } = await import("@/lib/google/outbox.server");
    await replayOutbox(supabaseAdmin, familyId);
  } catch { /* stays pending; hourly replay retries */ }
  const { data, error } = await supabaseAdmin.from("google_sync_outbox").select("status")
    .eq("family_id", familyId).in("event_id", [...new Set(eventIds)]);
  if (error) return { ...out, status: "pending", pending: eventIds.length };
  for (const r of data ?? []) {
    if (r.status === "synced") out.synced += 1;
    else if (r.status === "needs_attention") out.needsAttention += 1;
    else out.pending += 1;
  }
  out.status = out.needsAttention > 0 ? "needs_attention" : out.pending > 0 ? "pending" : out.synced > 0 ? "synced" : "not_applicable";
  return out;
}

export type { Assignment, ProposedShift };

type LineageRow = { id: string; split_from_event_id: string | null; split_from_date: string | null };

/**
 * Returns the reviewed version of every event a plan op references, taken from
 * the same event rows the plan was classified from. Fails closed (requiring a
 * refreshed review) when a referenced event is absent from that snapshot, has
 * no version, or its split lineage disagrees with the separately read lineage
 * map used for recurring-occurrence identity.
 */
export function snapshotEventVersions(
  plan: PublishPlan,
  snapshotEvents: { id: string; updated_at?: string | null; split_from_event_id?: string | null; split_from_date?: string | null }[],
  lineageRows: LineageRow[],
): Record<string, string> {
  const stale = "The calendar changed while this review was loading. Refresh the review.";
  const rows = new Map(snapshotEvents.map((e) => [e.id, e]));
  const lineage = new Map(lineageRows.map((r) => [r.id, r]));
  const versions: Record<string, string> = {};
  const ids = new Set<string>();
  for (const op of plan.ops) {
    // Conflicts already block readiness and never execute; orphaned
    // references must stay conflicts rather than fail the whole review.
    if (op.kind === "conflict") continue;
    if (op.eventId) ids.add(op.eventId);
    if (op.original?.eventId) ids.add(op.original.eventId);
  }
  for (const id of ids) {
    const row = rows.get(id);
    if (!row || !row.updated_at) throw new Error(stale);
    const lin = lineage.get(id);
    const rowFrom = row.split_from_event_id ?? null;
    const rowDate = row.split_from_date ?? null;
    if ((lin?.split_from_event_id ?? null) !== rowFrom || (lin?.split_from_date ?? null) !== rowDate) {
      throw new Error(stale);
    }
    versions[id] = row.updated_at;
  }
  return versions;
}
