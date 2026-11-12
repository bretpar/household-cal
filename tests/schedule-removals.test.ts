import { describe, expect, it } from "vitest";
import { deleteDraftShift, undoDraftRemoval, existingToProposal, draftSchema, type ExistingShift } from "@/lib/schedule-builder";
import { planPublish } from "@/lib/schedule-publish";
import { reviewReadiness, plannedHours } from "@/lib/schedule-review";

const original: ExistingShift = { eventId: "11111111-1111-4111-8111-111111111111", key: "original-occurrence", date: "2026-12-09", endDate: "2026-12-09",
  title: "Michelle", start: "07:30", end: "17:00", allDay: false, recurring: true, assignment: { kind: "none" },
  startAt: "2026-12-09T15:30:00Z", splitFromEventId: null, splitFromDate: null };
const shift = existingToProposal(original, "22222222-2222-4222-8222-222222222222");

describe("draft-only shift removals", () => {
  it("removes an unpublished shift without adding a deletion intent", () => {
    const { existing: _ref, ...fresh } = shift;
    const result = deleteDraftShift({ shifts: [fresh] }, fresh);
    expect(result.shifts).toEqual([]); expect(result.removals).toBeUndefined();
  });
  it("persists the original occurrence identity and undo restores a moved proposal", () => {
    const moved = { ...shift, date: "2026-12-08", start: "07:00" };
    const result = draftSchema.parse(JSON.parse(JSON.stringify(deleteDraftShift({ shifts: [moved] }, moved))));
    expect(result.shifts).toEqual([]); expect(result.removals?.[0]?.existing).toEqual(shift.existing);
    expect(undoDraftRemoval(result, moved.id).shifts).toEqual([moved]);
    expect(original.date).toBe("2026-12-09");
  });
  it("plans removal of only the original date while preserving other recurring dates", () => {
    const next = { ...original, key: "next-occurrence", date: "2026-12-16", endDate: "2026-12-16", startAt: "2026-12-16T15:30:00Z" };
    const draft = deleteDraftShift({ shifts: [] }, { ...shift, date: "2026-12-08" });
    const plan = planPublish(draft, [original, next]);
    expect(plan.ops[0]).toMatchObject({ kind: "exclude", occurrenceDate: "2026-12-09", requiresReview: true });
    expect(plan.preserved.map(e => e.key)).toEqual(["next-occurrence"]);
    expect(plannedHours(plan, draft)).toBe(9.5);
  });
  it("undoing deletion of an unchanged published shift restores the original without creating a proposal", () => {
    const result = undoDraftRemoval(deleteDraftShift({ shifts: [] }, shift), shift.id);
    expect(result.shifts).toEqual([]);
    expect(result.removals).toEqual([]);
  });
  it("requires explicit confirmation and a verified version for removals", () => {
    const plan = planPublish(deleteDraftShift({ shifts: [] }, shift), [original]);
    const op = plan.ops[0]; if (!op?.original) throw new Error("Expected original");
    op.original.eventVersion = "2026-12-01T00:00:00Z";
    expect(reviewReadiness(plan, new Set(), false).ready).toBe(false);
    expect(reviewReadiness(plan, new Set([shift.id]), false).ready).toBe(true);
    expect(reviewReadiness(plan, new Set([shift.id]), true).ready).toBe(false);
  });
  it("blocks a genuinely missing target and treats a journaled removal as already applied", () => {
    const draft = deleteDraftShift({ shifts: [] }, shift);
    expect(planPublish(draft, []).ops[0]?.kind).toBe("conflict");
    expect(planPublish(draft, [], {}, [shift.id]).ops[0]?.kind).toBe("unchanged");
  });
  it("removes a mapped replacement, never the excluded recurring parent", () => {
    const replacement = { ...original, eventId: "33333333-3333-4333-8333-333333333333", key: "replacement", date: "2026-12-08", endDate: "2026-12-08", splitFromEventId: original.eventId, splitFromDate: original.date };
    const plan = planPublish(deleteDraftShift({ shifts: [] }, shift), [replacement], { [shift.id]: replacement.eventId });
    expect(plan.ops[0]).toMatchObject({ kind: "exclude", eventId: replacement.eventId, occurrenceDate: "2026-12-08" });
  });
});