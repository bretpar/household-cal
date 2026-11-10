import { describe, expect, it } from "vitest";
import { groupPlanOps, reviewReadiness } from "@/lib/schedule-review";
import type { PublishPlan, PublishPlanOp } from "@/lib/schedule-publish";

const shiftA = "33333333-3333-4333-8333-333333333333";
const shiftB = "44444444-4444-4444-8444-444444444444";
const shiftC = "55555555-5555-4555-8555-555555555555";

function op(partial: Partial<PublishPlanOp>): PublishPlanOp {
  return {
    shiftId: shiftA,
    kind: "create",
    eventId: null,
    occurrenceKey: null,
    occurrenceDate: null,
    requiresReview: false,
    reason: null,
    ...partial,
  };
}

function planWith(ops: PublishPlanOp[]): PublishPlan {
  const counts = { unchanged: 0, create: 0, update: 0, exclude: 0, conflict: 0, preserved: 0 };
  for (const o of ops) counts[o.kind] += 1;
  return { ops, preserved: [], counts };
}

describe("groupPlanOps", () => {
  it("separates creates, updates, conflicts, excludes, and unchanged", () => {
    const groups = groupPlanOps(planWith([
      op({ shiftId: shiftA, kind: "create" }),
      op({ shiftId: shiftB, kind: "update", requiresReview: true }),
      op({ shiftId: shiftC, kind: "conflict", requiresReview: true, reason: "gone" }),
    ]));
    expect(groups.creates.map((o) => o.shiftId)).toEqual([shiftA]);
    expect(groups.updates.map((o) => o.shiftId)).toEqual([shiftB]);
    expect(groups.conflicts.map((o) => o.shiftId)).toEqual([shiftC]);
    expect(groups.excludes).toEqual([]);
    expect(groups.unchanged).toEqual([]);
  });
});

describe("reviewReadiness", () => {
  it("is ready when a fresh preview has only creates and unchanged ops", () => {
    const result = reviewReadiness(planWith([op({ kind: "create" }), op({ shiftId: shiftB, kind: "unchanged" })]), new Set(), false);
    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("blocks readiness while a modification to an existing shift is unconfirmed", () => {
    const plan = planWith([op({ kind: "update", requiresReview: true })]);
    const unconfirmed = reviewReadiness(plan, new Set(), false);
    expect(unconfirmed.ready).toBe(false);
    expect(unconfirmed.unreviewed.map((o) => o.shiftId)).toEqual([shiftA]);
    const confirmed = reviewReadiness(plan, new Set([shiftA]), false);
    expect(confirmed.ready).toBe(true);
  });

  it("blocks readiness while conflicts remain unresolved", () => {
    const result = reviewReadiness(planWith([op({ kind: "conflict", requiresReview: true, reason: "gone" })]), new Set([shiftA]), false);
    expect(result.ready).toBe(false);
    expect(result.conflictCount).toBe(1);
  });

  it("blocks readiness for unsupported occurrence removals", () => {
    const result = reviewReadiness(planWith([op({ kind: "exclude", requiresReview: true })]), new Set([shiftA]), false);
    expect(result.ready).toBe(false);
    expect(result.exclusionCount).toBe(1);
  });

  it("blocks readiness when the preview is stale even if everything is confirmed", () => {
    const result = reviewReadiness(planWith([op({ kind: "update", requiresReview: true })]), new Set([shiftA]), true);
    expect(result.ready).toBe(false);
    expect(result.stale).toBe(true);
  });
});
