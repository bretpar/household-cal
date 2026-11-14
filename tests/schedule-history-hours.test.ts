import { describe, expect, it } from "vitest";
import { hoursByCaregiver, hoursSummaryLines, type ExistingShift } from "@/lib/schedule-builder";
import { planPublish } from "@/lib/schedule-publish";

const ex = (date: string): ExistingShift => ({ key: `e1-${date}`, eventId: "e1", date, endDate: date, title: "Babysitter", start: "09:00", end: "17:00", allDay: false,
  assignment: { kind: "caregiver", family_member_id: "m1" }, startAt: `${date}T09:00:00.000Z`, splitFromEventId: null, splitFromDate: null });

describe("past-date protection", () => {
  it("blocks a new shift before today", () => {
    const plan = planPublish({ shifts: [{ id: "n", date: "2026-12-03", start: "09:00", end: "10:00", title: "B", assignment: { kind: "none" } }] }, [], {}, [], "UTC", "2026-12-10");
    expect(plan.ops[0].kind).toBe("conflict");
  });
  it("allows a new shift today", () => {
    const plan = planPublish({ shifts: [{ id: "n", date: "2026-12-10", start: "09:00", end: "10:00", title: "B", assignment: { kind: "none" } }] }, [], {}, [], "UTC", "2026-12-10");
    expect(plan.ops[0].kind).toBe("create");
  });
  it("blocks moving a past occurrence to the future", () => {
    const e = ex("2026-12-03");
    const plan = planPublish({ shifts: [{ id: "m", date: "2026-12-15", start: "09:00", end: "17:00", title: "Babysitter", assignment: e.assignment, existing: { eventId: "e1", occurrenceKey: e.key, startAt: e.startAt } }] }, [e], {}, [], "UTC", "2026-12-10");
    expect(plan.ops[0].kind).toBe("conflict");
  });
});

describe("monthly hours by caregiver", () => {
  it("sums per caregiver and puts unassigned under Other", () => {
    const r = hoursByCaregiver([ex("2026-12-01"), ex("2026-12-02"), { date: "2026-12-03", start: "08:00", end: "08:30", assignment: { kind: "none" } }], "2026-12");
    expect(r.total).toBe(16.5);
    expect(r.rows.find(x => x.key === "other")?.hours).toBe(0.5);
  });
  it("counts only the in-month part of an overnight shift", () => {
    expect(hoursByCaregiver([{ date: "2026-12-31", endDate: "2027-01-01", start: "20:00", end: "02:00", assignment: { kind: "none" } }], "2026-12").total).toBe(4);
  });
});

describe("monthly hours summary lines", () => {
  it("shows only the total when the month has no draft changes", () => {
    expect(hoursSummaryLines(126, 126, false)).toEqual({ total: "126 hours scheduled", published: "", change: "" });
  });
  it("compares proposed with published when draft changes exist", () => {
    expect(hoursSummaryLines(126, 133, true)).toEqual({
      total: "126 hours after changes",
      published: "133 hours currently published",
      change: "7 fewer hours",
    });
  });
  it("says more hours when the draft adds time, and no change when totals match", () => {
    expect(hoursSummaryLines(140, 133, true).change).toBe("7 more hours");
    expect(hoursSummaryLines(133, 133, true).change).toBe("No change in total hours");
  });
});
