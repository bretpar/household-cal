import { describe, expect, it } from "vitest";
import { acceptShiftChange, draftSchema, editSchedule, existingToProposal, shiftConfirmed, type ExistingShift } from "@/lib/schedule-builder";
import { parentWorkDays, type CoverageSettings } from "@/lib/smart-coverage";
import type { CalendarEvent } from "@/lib/family-data";

const id = "00000000-0000-4000-8000-000000000001";
const original: ExistingShift = { key: "occurrence", eventId: id, date: "2026-11-04", endDate: "2026-11-04", start: "08:00", end: "17:00", title: "Care",
  assignment: { kind: "caregiver", family_member_id: "00000000-0000-4000-8000-000000000002" }, startAt: "2026-11-04T16:00:00Z", allDay: false,
  recurring: true, splitFromEventId: null, splitFromDate: null };
const proposal = () => ({ ...existingToProposal(original, id), date: "2026-11-03" });
const version = "2026-11-01T12:00:00Z";

describe("private shift movement and confirmation", () => {
  it("moves a recurring occurrence without mutating its original, hours, or assignment", () => {
    const before = structuredClone(original);
    const moved = editSchedule({ shifts: [] }, "2026-11", { kind: "keep", shift: proposal() }).shifts[0];
    expect(moved).toMatchObject({ date: "2026-11-03", start: "08:00", end: "17:00", assignment: original.assignment,
      existing: { eventId: id, occurrenceKey: "occurrence", startAt: original.startAt } });
    expect(original).toEqual(before);
  });
  it("retains confirmation through draft serialization but invalidates it on edits or original version changes", () => {
    const accepted = acceptShiftChange({ shifts: [proposal()] }, id, [original], version);
    const saved = draftSchema.parse(JSON.parse(JSON.stringify(accepted))).shifts[0];
    if (!saved) throw new Error("Expected saved proposal");
    expect(shiftConfirmed(saved, version)).toBe(true);
    const moved = editSchedule(accepted, "2026-11", { kind: "move", id, date: "2026-11-05" }).shifts[0];
    if (!moved) throw new Error("Expected moved proposal");
    expect(shiftConfirmed(moved, version)).toBe(false);
    expect(shiftConfirmed(saved, "2026-11-02T12:00:00Z")).toBe(false);
  });
  it("cannot accept an overlapping or orphaned modification", () => {
    const collision = { ...original, key: "other", eventId: "00000000-0000-4000-8000-000000000003", date: "2026-11-03", endDate: "2026-11-03" };
    expect(() => acceptShiftChange({ shifts: [proposal()] }, id, [original, collision], version)).toThrow("Resolve");
    expect(() => acceptShiftChange({ shifts: [proposal()] }, id, [], version)).toThrow("Resolve");
    expect(() => acceptShiftChange({ shifts: [proposal()] }, id, [original], null)).toThrow("Resolve");
  });
  it("keeps all-day and overnight occurrences read-only", () => {
    expect(() => existingToProposal({ ...original, allDay: true }, id)).toThrow("same-day");
    expect(() => existingToProposal({ ...original, endDate: "2026-11-05" }, id)).toThrow("same-day");
  });
});

const settings: CoverageSettings = { parents: [
  { label: "Dad", sourceId: "work", sourceName: "Work", health: "ok" },
  { label: "Mom", sourceId: "hidden", sourceName: "Other work", health: "hidden" }], bufferBefore: 0, bufferAfter: 0 };
const event = (source: string, allDay = false): CalendarEvent => ({ id: source, calendar_source_id: source, title: "Sensitive title",
  start_at: "2026-11-03T16:00:00Z", end_at: "2026-11-04T01:00:00Z", all_day: allDay, recurrence_rule: null,
  excluded_dates: [], participants: [], member_ids: [] } as unknown as CalendarEvent);

describe("parent work-hour summaries", () => {
  it("shows only selected caller-visible work intervals in household time, without titles", () => {
    const days = parentWorkDays("2026-11", "America/Los_Angeles", settings, [event("work"), event("personal"), event("hidden")], {});
    expect(days["2026-11-03"]).toEqual([
      { label: "Dad", intervals: [[480, 1020]], unavailable: false, manualReview: false },
      { label: "Mom", intervals: [], unavailable: true, manualReview: false }]);
    expect(JSON.stringify(days)).not.toContain("Sensitive title");
  });
  it("marks unverified import coverage unavailable even when visible hours exist", () => {
    const s = structuredClone(settings); s.parents[0].range = null;
    expect(parentWorkDays("2026-11", "America/Los_Angeles", s, [event("work")], {})["2026-11-03"]?.[0])
      .toMatchObject({ intervals: [[480, 1020]], unavailable: true });
  });
  it("marks all-day work for manual review instead of inventing timed hours", () => {
    expect(parentWorkDays("2026-11", "America/Los_Angeles", settings, [event("work", true)], {})["2026-11-03"]?.[0])
      .toMatchObject({ intervals: [], manualReview: true });
  });
});