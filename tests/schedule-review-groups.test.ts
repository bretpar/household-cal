import { describe, expect, it } from "vitest";
import { reviewReadiness } from "@/lib/schedule-review";
import type { PublishPlan, PublishPlanOp } from "@/lib/schedule-publish";

const A = "33333333-3333-4333-8333-333333333333";
const B = "44444444-4444-4444-8444-444444444444";
const C = "55555555-5555-4555-8555-555555555555";
const D = "66666666-6666-4666-8666-666666666666";
const none = { kind: "none" as const };

function op(partial: Partial<PublishPlanOp>): PublishPlanOp {
  return {
    shiftId: A,
    kind: "create",
    eventId: null,
    occurrenceKey: null,
    occurrenceDate: null,
    requiresReview: false,
    reason: null,
    ...partial,
  };
}

/** A server-verified, version-bound original: eventId/occurrenceKey must match the op. */
function verified(shiftId: string, eventId: string, key: string): Partial<PublishPlanOp> {
  return {
    shiftId,
    eventId,
    occurrenceKey: key,
    requiresReview: true,
    original: {
      eventId, occurrenceKey: key, date: "2026-12-10", endDate: "2026-12-10",
      start: "09:00", end: "13:00", allDay: false, title: "Sitter",
      assignment: none, recurring: false, eventVersion: "v1",
    },
  };
}

function planWith(ops: PublishPlanOp[]): PublishPlan {
  const counts = { unchanged: 0, create: 0, update: 0, exclude: 0, conflict: 0, preserved: 0 };
  for (const o of ops) counts[o.kind] += 1;
  return { ops, preserved: [], counts };
}

describe("group confirmations", () => {
  const plan = planWith([
    op({ ...verified(A, "77777777-7777-4777-8777-777777777777", "k-a"), kind: "update" }),
    op({ ...verified(B, "88888888-8888-4888-8888-888888888888", "k-b"), kind: "exclude" }),
    op({ shiftId: C, kind: "create" }),
    op({ shiftId: D, kind: "unchanged" }),
  ]);

  it("blocks every nonempty category until its own group is confirmed", () => {
    expect(reviewReadiness(plan, new Set(), false).blockers).toEqual([
      "Confirm all changes — 1 modification to existing shifts needs confirmation.",
      "Confirm additions — 1 new shift needs confirmation.",
      "Confirm removals — 1 removal needs confirmation.",
    ]);
  });

  it("confirms every operation in a category through its group checkbox", () => {
    const changes = reviewReadiness(plan, new Set([A]), false);
    expect(changes.ready).toBe(false);
    expect(changes.blockers).toEqual([
      "Confirm additions — 1 new shift needs confirmation.",
      "Confirm removals — 1 removal needs confirmation.",
    ]);
    expect(reviewReadiness(plan, new Set([A, B, C]), false).ready).toBe(true);
  });

  it("omits confirmation blockers for empty categories", () => {
    const addsOnly = planWith([op({ shiftId: C, kind: "create" }), op({ shiftId: D, kind: "unchanged" })]);
    expect(reviewReadiness(addsOnly, new Set(), false).blockers)
      .toEqual(["Confirm additions — 1 new shift needs confirmation."]);
  });

  it("names one blocker per category no matter how many operations it holds", () => {
    const manyAdds = planWith([
      op({ shiftId: A, kind: "create" }), op({ shiftId: B, kind: "create" }), op({ shiftId: C, kind: "create" }),
    ]);
    expect(reviewReadiness(manyAdds, new Set(), false).blockers)
      .toEqual(["Confirm additions — 3 new shifts need confirmation."]);
  });

  it("group approval cannot clear an unresolved conflict", () => {
    const withConflict = planWith([
      op({ shiftId: A, kind: "conflict", requiresReview: true, reason: "gone" }),
      op({ shiftId: C, kind: "create" }),
    ]);
    const r = reviewReadiness(withConflict, new Set([A, C]), false);
    expect(r.ready).toBe(false);
    expect(r.conflictCount).toBe(1);
    expect(r.blockers).toContain("1 conflict needs attention in the builder.");
  });

  it("group approval cannot clear a stale preview", () => {
    expect(reviewReadiness(plan, new Set([A, B, C]), true).ready).toBe(false);
  });

  it("group approval cannot clear an original the server could not verify", () => {
    const unverifiable = planWith([op({ shiftId: A, kind: "update", requiresReview: true, eventId: "77777777-7777-4777-8777-777777777777" })]);
    const r = reviewReadiness(unverifiable, new Set([A]), false);
    expect(r.ready).toBe(false);
    expect(r.blockers[0]).toBe("Original details for some changed shifts couldn't be verified. Refresh the preview.");
  });
});
