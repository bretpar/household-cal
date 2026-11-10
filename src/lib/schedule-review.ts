/**
 * Pure review-state helpers for the Babysitter Schedule Builder's
 * Review & Publish flow. UI-free so the same rules can back a future
 * mobile review interface. Planning itself stays server-side; these
 * helpers only group the returned plan and decide review readiness.
 */
import type { PublishPlan, PublishPlanOp } from "@/lib/schedule-publish";
import type { ScheduleDraft } from "@/lib/schedule-builder";

export interface GroupedPlanOps {
  /** New shifts the draft would add. */
  creates: PublishPlanOp[];
  /** Proposed modifications to existing calendar occurrences. */
  updates: PublishPlanOp[];
  /** Proposals whose referenced occurrence is gone or whose published event vanished. */
  conflicts: PublishPlanOp[];
  /** Occurrence removals: unsupported by the builder; always block readiness. */
  excludes: PublishPlanOp[];
  /** Proposals identical to the existing occurrence. */
  unchanged: PublishPlanOp[];
}

export function groupPlanOps(plan: PublishPlan): GroupedPlanOps {
  const groups: GroupedPlanOps = { creates: [], updates: [], conflicts: [], excludes: [], unchanged: [] };
  for (const op of plan.ops) {
    if (op.kind === "create") groups.creates.push(op);
    else if (op.kind === "update") groups.updates.push(op);
    else if (op.kind === "conflict") groups.conflicts.push(op);
    else if (op.kind === "exclude") groups.excludes.push(op);
    else groups.unchanged.push(op);
  }
  return groups;
}

/**
 * Effective planned hours for the month: publishable draft shifts (new,
 * changed, unchanged) plus preserved existing shifts. Conflicts and
 * unsupported removals are excluded because they cannot publish.
 */
export function plannedHours(plan: PublishPlan, draft: ScheduleDraft): number {
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const byId = new Map(draft.shifts.map((s) => [s.id, s]));
  let total = 0;
  for (const op of plan.ops) {
    if (op.kind !== "create" && op.kind !== "update" && op.kind !== "unchanged") continue;
    const s = byId.get(op.shiftId);
    if (s) total += minutes(s.end) - minutes(s.start);
  }
  for (const e of plan.preserved) {
    if (!e.allDay && e.date === e.endDate) total += Math.max(0, minutes(e.end) - minutes(e.start));
  }
  return total / 60;
}

export interface ReviewReadiness {
  /** Update ops the Owner has not explicitly confirmed yet. */
  unreviewed: PublishPlanOp[];
  conflictCount: number;
  exclusionCount: number;
  stale: boolean;
  /** Human-readable reasons publishing is not ready, in display order. */
  blockers: string[];
  ready: boolean;
}

/**
 * Decides whether a reviewed preview is ready to publish. Ready requires a
 * fresh (non-stale) preview, zero unresolved conflicts, zero unsupported
 * occurrence removals, and explicit confirmation of every modification to an
 * existing occurrence. Existing occurrences are preserved by default and
 * never need confirmation.
 */
export function reviewReadiness(
  plan: PublishPlan,
  confirmed: ReadonlySet<string>,
  stale: boolean,
): ReviewReadiness {
  const { updates, conflicts, excludes } = groupPlanOps(plan);
  const unreviewed = updates.filter((op) => !confirmed.has(op.shiftId));
  const blockers: string[] = [];
  if (stale) blockers.push("The draft changed since this preview. Save the draft and refresh the preview.");
  if (conflicts.length > 0) {
    blockers.push(`${conflicts.length} ${conflicts.length === 1 ? "conflict needs" : "conflicts need"} attention in the builder.`);
  }
  if (excludes.length > 0) {
    blockers.push("Removing existing calendar occurrences is not supported; those shifts stay unchanged.");
  }
  if (unreviewed.length > 0) {
    blockers.push(`${unreviewed.length} ${unreviewed.length === 1 ? "change" : "changes"} to existing shifts still ${unreviewed.length === 1 ? "needs" : "need"} confirmation.`);
  }
  return {
    unreviewed,
    conflictCount: conflicts.length,
    exclusionCount: excludes.length,
    stale,
    blockers,
    ready: blockers.length === 0,
  };
}
