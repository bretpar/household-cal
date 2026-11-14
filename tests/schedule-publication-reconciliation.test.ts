import { describe, expect, it } from "vitest";
import {
  existingToProposal,
  reconcilePublishedDraft,
  scheduleProposalTone,
  type ExistingShift,
  type ProposedShift,
  type ScheduleDraft,
} from "@/lib/schedule-builder";

const caregiver = { kind: "caregiver" as const, family_member_id: "11111111-1111-4111-8111-111111111111" };
const eventId = "22222222-2222-4222-8222-222222222222";
const existing: ExistingShift = {
  key: `${eventId}-2026-12-10T17:00:00.000Z`, eventId, date: "2026-12-10", title: "Michelle",
  start: "09:00", end: "17:00", allDay: false, assignment: caregiver,
  startAt: "2026-12-10T17:00:00.000Z", endDate: "2026-12-10", splitFromEventId: null, splitFromDate: null,
};
const addition: ProposedShift = {
  id: "33333333-3333-4333-8333-333333333333", date: "2026-12-11", start: "10:00", end: "15:00",
  title: "Michelle", assignment: caregiver,
};
const modification = { ...existingToProposal(existing, "44444444-4444-4444-8444-444444444444"), end: "18:00" };
const removal = existingToProposal({ ...existing, key: `${eventId}-2026-12-15T17:00:00.000Z`, date: "2026-12-15", endDate: "2026-12-15", startAt: "2026-12-15T17:00:00.000Z" },
  "55555555-5555-4555-8555-555555555555");
const draft: ScheduleDraft = {
  shifts: [addition, modification], removals: [removal],
  coverage: { ignored: ["ignored-suggestion"], noCare: ["2026-12-18"] },
};

describe("post-publication draft reconciliation", () => {
  it("clears every confirmed operation after a complete publication", () => {
    const next = reconcilePublishedDraft(draft, [addition.id, modification.id, removal.id]);
    expect(next.shifts).toEqual([]);
    expect(next.removals).toEqual([]);
    expect(next.coverage).toEqual(draft.coverage);
  });

  it("retains each failed or pending operation after a partial publication", () => {
    const next = reconcilePublishedDraft(draft, [modification.id]);
    expect(next.shifts).toEqual([addition]);
    expect(next.removals).toEqual([removal]);
  });

  it("does not clear anything merely because publishing was clicked", () => {
    expect(reconcilePublishedDraft(draft, [])).toBe(draft);
  });

  it("is idempotent when an applied result is confirmed again", () => {
    const once = reconcilePublishedDraft(draft, [addition.id, removal.id]);
    expect(reconcilePublishedDraft(once, [addition.id, removal.id])).toEqual(once);
  });
});

describe("monthly colors around publication", () => {
  it("shows a confirmed published addition as blue, then a later addition as green", () => {
    const publishedAddition = { ...existing, ...addition, key: "new-event-occurrence", eventId: "66666666-6666-4666-8666-666666666666", startAt: "2026-12-11T18:00:00.000Z", endDate: addition.date };
    expect(scheduleProposalTone(addition, [publishedAddition], [addition], { [addition.id]: publishedAddition.eventId })).toBe("existing");
    expect(scheduleProposalTone(addition, [], [addition])).toBe("new");
  });

  it("shows a matching published modification as blue and a subsequent edit as yellow", () => {
    const publishedModification = { ...existing, end: "18:00" };
    expect(scheduleProposalTone(modification, [publishedModification], [modification])).toBe("existing");
    const edited = { ...modification, end: "19:00" };
    expect(scheduleProposalTone(edited, [publishedModification], [edited])).toBe("modified");
  });

  it("keeps failed additions and modifications in their proposal colors", () => {
    expect(scheduleProposalTone(addition, [], [addition])).toBe("new");
    expect(scheduleProposalTone(modification, [existing], [modification])).toBe("modified");
  });

  it("keeps a genuine missing-original conflict red", () => {
    expect(scheduleProposalTone(modification, [], [modification])).toBe("conflict");
  });
});
