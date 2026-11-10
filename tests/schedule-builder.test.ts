import { describe, expect, it } from "vitest";
import { appendProposals, buildTemplate, draftSchema, proposalNeedsReview, type ExistingShift, type ProposedShift, type ScheduleTemplate } from "@/lib/schedule-builder";

const template: ScheduleTemplate = { assignment: { kind: "none" }, weekdays: [{ day: 1, start: "09:00", end: "17:00" }] };
let counter = 0;
const id = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const existingShift = (s: ProposedShift): ExistingShift => {
  const eventId = id(); const startAt = `${s.date}T${s.start}:00Z`;
  return { key: `${eventId}-${startAt}`, eventId, date: s.date, title: "Existing care", start: s.start, end: s.end,
    allDay: false, assignment: s.assignment, startAt, endDate: s.date, splitFromEventId: null, splitFromDate: null };
};

describe("private monthly schedule proposals", () => {
  it("generates month-bounded individual Monday shifts, not recurring events", () => {
    const shifts = buildTemplate("2026-11", template, id);
    expect(shifts.map(s => s.date)).toEqual(["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
    expect(new Set(shifts.map(s => s.id)).size).toBe(5);
  });
  it("preserves draft proposals and makes template reapplication idempotent", () => {
    const first = buildTemplate("2026-11", template, id);
    const result = appendProposals({ shifts: first }, buildTemplate("2026-11", template, id));
    expect(result.shifts).toHaveLength(5);
    expect(result.shifts).toEqual(first);
  });
  it("leaves an exact existing calendar slot as an event, not a proposal", () => {
    const shifts = buildTemplate("2026-11", template, id);
    const existing = shifts.map(existingShift);
    expect(appendProposals({ shifts: [] }, shifts, existing).shifts).toEqual([]);
    expect(existing.map(s => s.title)).toEqual(Array(5).fill("Existing care"));
  });
  it("preserves a different existing shift and flags the template mismatch for review", () => {
    const shifts = buildTemplate("2026-11", template, id);
    const existing = shifts.map(s => ({ ...existingShift(s), start: "08:00" }));
    const before = structuredClone(existing);
    const result = appendProposals({ shifts: [] }, shifts, existing);
    expect(result.shifts).toHaveLength(5);
    expect(result.shifts.every(s => proposalNeedsReview(s, existing))).toBe(true);
    expect(existing).toEqual(before);
    expect(appendProposals(result, buildTemplate("2026-11", template, id), existing)).toEqual(result);
  });
  it("compares caregiver identity, not just dates and times", () => {
    const shifts = buildTemplate("2026-11", template, id);
    const existing = shifts.map(s => ({ ...existingShift(s), assignment: { kind: "caregiver" as const, family_member_id: id() } }));
    expect(appendProposals({ shifts: [] }, shifts, existing).shifts).toHaveLength(5);
    expect(shifts.every(s => proposalNeedsReview(s, existing))).toBe(true);
  });
  it("deduplicates stable occurrence and replacement lineage identities", () => {
    const s = buildTemplate("2026-11", template, id)[0];
    if (!s) throw new Error("Expected a Monday shift");
    const original = existingShift(s);
    const proposal = { ...s, existing: { eventId: original.eventId, occurrenceKey: original.key, startAt: original.startAt,
      splitFromEventId: null, splitFromDate: null } };
    const replacement = { ...original, eventId: id(), key: "replacement", start: "10:00", splitFromEventId: original.eventId, splitFromDate: s.date };
    expect(appendProposals({ shifts: [] }, [proposal], [replacement]).shifts).toEqual([]);
    expect(appendProposals({ shifts: [proposal] }, [{ ...proposal, id: id(), start: "11:00" }]).shifts).toEqual([proposal]);
  });
  it("does not match all-day or overnight existing shifts to same-day proposals", () => {
    const shifts = buildTemplate("2026-11", template, id);
    const allDay = shifts.map(s => ({ ...existingShift(s), allDay: true }));
    const overnight = shifts.map(s => ({ ...existingShift(s), endDate: `${s.date.slice(0, 8)}${String(Number(s.date.slice(8)) + 1).padStart(2, "0")}` }));
    expect(appendProposals({ shifts: [] }, shifts, allDay).shifts).toHaveLength(5);
    expect(appendProposals({ shifts: [] }, shifts, overnight).shifts).toHaveLength(5);
  });
  it("rejects nonpositive same-day proposed shift times", () => {
    const shift = buildTemplate("2026-11", template, id)[0];
    expect(draftSchema.safeParse({ shifts: [{ ...shift, start: "17:00", end: "09:00" }] }).success).toBe(false);
  });
});