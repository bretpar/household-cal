import { describe, expect, it } from "vitest";
import { appendProposals, proposalNeedsReview, type ExistingShift, type ProposedShift } from "@/lib/schedule-builder";
import { planPublish } from "@/lib/schedule-publish";
import { suggestionToShift } from "@/lib/smart-coverage";
import { reviewReadiness } from "@/lib/schedule-review";

const caregiver = { kind: "caregiver" as const, family_member_id: "11111111-1111-4111-8111-111111111111" };
const id = "22222222-2222-4222-8222-222222222222";
const eventId = "33333333-3333-4333-8333-333333333333";
const live: ExistingShift = { key: `${eventId}-2026-12-09T16:30:00.000Z`, eventId, date: "2026-12-09", endDate: "2026-12-09", start: "08:30", end: "16:30", title: "Babysitter", assignment: caregiver, allDay: false, recurring: true, startAt: "2026-12-09T16:30:00.000Z", splitFromEventId: null, splitFromDate: null };
const shift = (start: string, end: string): ProposedShift => ({ id, date: live.date, start, end, title: "Babysitter", assignment: caregiver });

describe("shared schedule interval conflicts", () => {
  it("accepts the Dec 9 08:00–08:30 coverage suggestion next to 08:30–16:30 and preserves recurrence", () => {
    const suggestion = suggestionToShift({ key: "gap", date: live.date, start: "08:00", end: "08:30" }, caregiver, id);
    const draft = appendProposals({ shifts: [] }, [suggestion], [live]);
    expect(draft.shifts).toEqual([suggestion]);
    expect(proposalNeedsReview(suggestion, [live])).toBe(false);
    const plan = planPublish(draft, [live]);
    expect(plan.ops[0]?.kind).toBe("create");
    expect(plan.preserved).toEqual([live]);
    expect(reviewReadiness(plan, new Set(), false).ready).toBe(true);
  });
  it.each([["06:00", "07:00"], ["16:30", "17:30"]])("allows separate or adjacent %s–%s manual shifts", (start, end) => {
    expect(proposalNeedsReview(shift(start, end), [live])).toBe(false);
    expect(planPublish({ shifts: [shift(start, end)] }, [live]).counts.conflict).toBe(0);
  });
  it("blocks an exact existing duplicate in direct server review and drops it during template reconciliation", () => {
    const duplicate = shift("08:30", "16:30");
    expect(appendProposals({ shifts: [] }, [duplicate], [live]).shifts).toEqual([]);
    expect(planPublish({ shifts: [duplicate] }, [live]).counts.conflict).toBe(1);
  });
  it.each([caregiver, { kind: "caregiver" as const, family_member_id: "55555555-5555-4555-8555-555555555555" }, { kind: "none" as const }, { kind: "other" as const, name: "Alex" }])("blocks overlapping existing assignments: %j", assignment => {
    expect(planPublish({ shifts: [{ ...shift("08:00", "09:00"), assignment }] }, [live]).counts.conflict).toBe(1);
  });
  it("blocks overlapping draft shifts, not just exact duplicates", () => {
    const a = shift("06:00", "08:00");
    const b = { ...shift("07:00", "08:30"), id: "44444444-4444-4444-8444-444444444444" };
    expect(planPublish({ shifts: [a, b] }, []).counts.conflict).toBe(2);
  });
  it("uses a referenced modification's proposed interval rather than its superseded original interval", () => {
    const change = { ...shift("09:00", "16:30"), id: "44444444-4444-4444-8444-444444444444", existing: { eventId, occurrenceKey: live.key, startAt: live.startAt, splitFromEventId: null, splitFromDate: null } };
    const plan = planPublish({ shifts: [change, shift("08:00", "09:00")] }, [live]);
    expect(plan.ops.map(op => op.kind)).toEqual(["update", "create"]);
  });
  it("reconciles new shifts against the effective draft while retaining template idempotency", () => {
    const change = { ...shift("09:00", "16:30"), id: "44444444-4444-4444-8444-444444444444", existing: { eventId, occurrenceKey: live.key, startAt: live.startAt, splitFromEventId: null, splitFromDate: null } };
    const draft = appendProposals({ shifts: [change] }, [shift("08:30", "16:30")], [live]);
    expect(draft.shifts).toHaveLength(2);
    expect(planPublish(draft, [live]).counts.conflict).toBe(2);
    expect(appendProposals(draft, [{ ...shift("08:30", "16:30"), id: "55555555-5555-4555-8555-555555555555" }], [live])).toEqual(draft);
  });
  it("blocks a referenced modification overlapping another preserved occurrence", () => {
    const change = { ...shift("08:00", "17:00"), existing: { eventId, occurrenceKey: live.key, startAt: live.startAt, splitFromEventId: null, splitFromDate: null } };
    const other = { ...live, key: "afternoon", eventId: "55555555-5555-4555-8555-555555555555", start: "16:30", end: "18:00" };
    expect(planPublish({ shifts: [change] }, [live, other]).counts.conflict).toBe(1);
  });
  it("allows adjacent draft shifts and blocks genuine duplicate proposals", () => {
    const a = shift("06:00", "08:00");
    const b = { ...shift("08:00", "08:30"), id: "44444444-4444-4444-8444-444444444444" };
    expect(planPublish({ shifts: [a, b] }, []).counts.create).toBe(2);
    expect(planPublish({ shifts: [a, { ...a, id: b.id }] }, []).counts.conflict).toBe(2);
  });
  it("treats a midnight-ending overnight shift as end-exclusive", () => {
    const overnight = { ...live, date: "2026-12-08", endDate: "2026-12-08", start: "22:00", end: "00:00" };
    expect(planPublish({ shifts: [shift("08:00", "08:30")] }, [overnight]).counts.conflict).toBe(0);
  });
});