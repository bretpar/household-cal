import { describe, expect, it } from "vitest";
import { planPublish } from "@/lib/schedule-publish";
import type { ExistingShift } from "@/lib/schedule-builder";
import type { ScheduleDraft } from "@/lib/schedule-builder";

const caregiver = { kind: "caregiver" as const, family_member_id: "11111111-1111-4111-8111-111111111111" };

function existing(partial: Partial<ExistingShift> = {}): ExistingShift {
  return {
    key: "evt-1-2026-11-10T17:00:00.000Z",
    eventId: "22222222-2222-4222-8222-222222222222",
    date: "2026-11-10",
    title: "Babysitter",
    start: "09:00",
    end: "17:00",
    allDay: false,
    assignment: caregiver,
    startAt: "2026-11-10T17:00:00.000Z",
    endDate: "2026-11-10",
    splitFromEventId: null,
    splitFromDate: null,
    ...partial,
  };
}

function draftWith(shifts: ScheduleDraft["shifts"]): ScheduleDraft {
  return { shifts };
}

const baseShift = {
  id: "33333333-3333-4333-8333-333333333333",
  date: "2026-11-10",
  start: "09:00",
  end: "17:00",
  title: "Babysitter",
  assignment: caregiver,
};

describe("planPublish", () => {
  it("classifies matching referenced occurrences as unchanged", () => {
    const plan = planPublish(
      draftWith([{ ...baseShift, existing: { eventId: existing().eventId, occurrenceKey: existing().key, startAt: existing().startAt, splitFromEventId: null, splitFromDate: null } }]),
      [existing()],
    );
    expect(plan.ops[0]?.kind).toBe("unchanged");
    expect(plan.counts.unchanged).toBe(1);
    expect(plan.preserved).toHaveLength(0);
  });

  it("classifies new shifts as create without review", () => {
    const plan = planPublish(draftWith([baseShift]), []);
    expect(plan.ops[0]).toMatchObject({ kind: "create", requiresReview: false });
  });

  it("requires an update and review for a proposal mapped to a published event", () => {
    const plan = planPublish(draftWith([baseShift]), [existing()], { [baseShift.id]: existing().eventId });
    expect(plan.ops[0]).toMatchObject({ kind: "update", requiresReview: true, eventId: existing().eventId });
    expect(plan.counts.create).toBe(0);
    expect(plan.preserved).toHaveLength(0);
  });

  it("never recreates a mapped proposal whose published event is missing", () => {
    const plan = planPublish(draftWith([baseShift]), [], { [baseShift.id]: existing().eventId });
    expect(plan.ops[0]).toMatchObject({ kind: "conflict", eventId: existing().eventId });
    expect(plan.counts.create).toBe(0);
  });

  it("flags changed referenced occurrences as update requiring review", () => {
    const plan = planPublish(
      draftWith([{ ...baseShift, start: "10:00", existing: { eventId: existing().eventId, occurrenceKey: existing().key, startAt: existing().startAt, splitFromEventId: null, splitFromDate: null } }]),
      [existing()],
    );
    expect(plan.ops[0]).toMatchObject({ kind: "update", requiresReview: true });
  });

  it("reports a conflict when the referenced occurrence is gone, never matching by title/time", () => {
    const lookalike = existing({ key: "evt-9-2026-11-10T17:00:00.000Z", eventId: "99999999-9999-4999-8999-999999999999" });
    const plan = planPublish(
      draftWith([{ ...baseShift, existing: { eventId: existing().eventId, occurrenceKey: existing().key, startAt: existing().startAt, splitFromEventId: null, splitFromDate: null } }]),
      [lookalike],
    );
    expect(plan.ops[0]?.kind).toBe("conflict");
    expect(plan.preserved).toHaveLength(1);
  });

  it("preserves unreferenced existing occurrences instead of deleting them", () => {
    const plan = planPublish(draftWith([]), [existing(), existing({ key: "k2", date: "2026-11-12" })]);
    expect(plan.ops).toHaveLength(0);
    expect(plan.preserved).toHaveLength(2);
    expect(plan.counts.preserved).toBe(2);
  });
});
