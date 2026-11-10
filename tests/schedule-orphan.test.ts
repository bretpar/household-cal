import { describe, it, expect } from "vitest";
import { proposalOrphaned, convertOrphanToNew, scheduleSummary, type ExistingShift, type ProposedShift } from "@/lib/schedule-builder";
const ev = "11111111-1111-4111-8111-111111111111";
const orphan: ProposedShift = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", date: "2026-12-03", start: "09:00", end: "13:00", title: "Babysitter", assignment: { kind: "none" },
  existing: { eventId: ev, occurrenceKey: `${ev}-x`, startAt: "2026-12-03T17:00:00.000Z" } };
const live: ExistingShift = { key: `${ev}-x`, eventId: ev, date: "2026-12-03", endDate: "2026-12-03", title: "Babysitter", start: "09:00", end: "13:00", startAt: "2026-12-03T17:00:00.000Z", allDay: false, recurring: false, assignment: { kind: "none" } } as ExistingShift;
describe("orphaned change proposals", () => {
  it("flags a proposal whose original occurrence is gone and counts it as a conflict", () => {
    expect(proposalOrphaned(orphan, [])).toBe(true);
    expect(proposalOrphaned(orphan, [live])).toBe(false);
    expect(scheduleSummary({ shifts: [orphan] }, []).conflicts).toBe(1);
  });
  it("converts to a standalone proposal with a new id and no reference", () => {
    const r = convertOrphanToNew({ shifts: [orphan] }, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", [], () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(r.added).toBe(true);
    expect(r.draft.shifts).toHaveLength(1);
    expect(r.draft.shifts[0].id).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(r.draft.shifts[0].existing).toBeUndefined();
    expect(scheduleSummary(r.draft, []).conflicts).toBe(0);
  });
  it("drops the conversion when it duplicates another proposal", () => {
    const { existing: _e, ...base } = orphan; const dup: ProposedShift = { ...base, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
    const r = convertOrphanToNew({ shifts: [orphan, dup] }, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", [], () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(r.added).toBe(false);
    expect(r.draft.shifts.map(s => s.id)).toEqual(["cccccccc-cccc-4ccc-8ccc-cccccccccccc"]);
  });
  it("does nothing when the original still exists", () => {
    const r = convertOrphanToNew({ shifts: [orphan] }, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", [live], () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(r.added).toBe(false); expect(r.draft.shifts[0].id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });
});
import { orphanStatus } from "@/lib/schedule-builder";
describe("orphan status", () => {
  it("labels a shift moved to another month as moved, not deleted, and keeps it a conflict", () => {
    expect(orphanStatus(orphan, [], { [ev]: { onSitterCalendar: true, month: "2027-01", recurring: false } }, [ev], "2026-12")).toBe("moved");
    expect(scheduleSummary({ shifts: [orphan] }, []).conflicts).toBe(1);
  });
  it("is deleted only when the server checked and found nothing", () => {
    expect(orphanStatus(orphan, [], {}, [ev], "2026-12")).toBe("deleted");
    expect(orphanStatus(orphan, [], {}, [], "2026-12")).toBe("unresolved");
  });
  it("is unresolved for a recurring master or an event off the Babysitter calendar", () => {
    expect(orphanStatus(orphan, [], { [ev]: { onSitterCalendar: true, month: "2026-11", recurring: true } }, [ev], "2026-12")).toBe("unresolved");
    expect(orphanStatus(orphan, [], { [ev]: { onSitterCalendar: false, month: "2027-01", recurring: false } }, [ev], "2026-12")).toBe("unresolved");
  });
});
