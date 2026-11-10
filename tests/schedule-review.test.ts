import { describe, expect, it } from "vitest";
import { groupPlanOps, plannedHours, reviewReadiness } from "@/lib/schedule-review";
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

describe("modified shift plus conflict", () => {
  const plan = planWith([
    op({ shiftId: shiftA, kind: "update", requiresReview: true }),
    op({ shiftId: shiftB, kind: "conflict", requiresReview: true, reason: "gone" }),
  ]);
  it("stays blocked by the conflict after the change is confirmed", () => {
    const r = reviewReadiness(plan, new Set([shiftA]), false);
    expect(r.ready).toBe(false);
    expect(r.unreviewed).toEqual([]);
    expect(r.conflictCount).toBe(1);
  });
  it("counts hours only for publishable shifts plus kept existing shifts", () => {
    const draft = { shifts: [
      { id: shiftA, date: "2026-11-10", start: "09:00", end: "13:00", title: "B", assignment: { kind: "none" as const } },
      { id: shiftB, date: "2026-11-11", start: "09:00", end: "17:00", title: "B", assignment: { kind: "none" as const } },
    ] };
    const withKept = { ...plan, preserved: [{ key: "k", eventId: shiftC, date: "2026-11-12", title: "B", start: "10:00", end: "12:00",
      allDay: false, assignment: { kind: "none" as const }, startAt: "2026-11-12T18:00:00.000Z", endDate: "2026-11-12", splitFromEventId: null, splitFromDate: null }] };
    expect(plannedHours(withKept, draft)).toBe(6);
  });
});

describe("reviewReadiness", () => {
  it("is ready when a fresh preview has only creates and unchanged ops", () => {
    const result = reviewReadiness(planWith([op({ kind: "create" }), op({ shiftId: shiftB, kind: "unchanged" })]), new Set(), false);
    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("blocks readiness while a modification to an existing shift is unconfirmed", () => {
    const plan = planWith([op({ kind: "update", requiresReview: true, eventId: shiftC, occurrenceKey: "k",
      original: { eventId: shiftC, occurrenceKey: "k", date: "2026-11-10", endDate: "2026-11-10", start: "09:00", end: "13:00",
        allDay: false, title: "B", assignment: { kind: "none" }, recurring: false, eventVersion: "v1" } })]);
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
