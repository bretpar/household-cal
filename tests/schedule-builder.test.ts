import { describe, expect, it } from "vitest";
import { appendProposals, buildTemplate, draftSchema, type ScheduleTemplate } from "@/lib/schedule-builder";

const template: ScheduleTemplate = { assignment: { kind: "none" }, weekdays: [{ day: 1, start: "09:00", end: "17:00" }] };
let counter = 0;
const id = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

describe("private monthly schedule proposals", () => {
  it("generates month-bounded individual Monday shifts, not recurring events", () => {
    const shifts = buildTemplate("2026-11", template, id);
    expect(shifts.map(s => s.date)).toEqual(["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
    expect(new Set(shifts.map(s => s.id)).size).toBe(5);
  });
  it("preserves existing draft proposals when adding a template", () => {
    const first = buildTemplate("2026-11", template, id);
    const result = appendProposals({ shifts: first }, buildTemplate("2026-11", template, id));
    expect(result.shifts).toHaveLength(10);
    expect(result.shifts.slice(0, 5)).toEqual(first);
  });
  it("rejects nonpositive same-day proposed shift times", () => {
    const shift = buildTemplate("2026-11", template, id)[0];
    expect(draftSchema.safeParse({ shifts: [{ ...shift, start: "17:00", end: "09:00" }] }).success).toBe(false);
  });
});