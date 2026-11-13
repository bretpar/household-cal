import { describe, expect, it } from "vitest";
import { computeScheduleCoverage, confirmedCoverageGaps } from "@/lib/schedule-coverage";
import type { CoverageInput } from "@/lib/smart-coverage";
import type { CalendarEvent } from "@/lib/family-data";
import type { ExistingShift, ProposedShift } from "@/lib/schedule-builder";

const date = "2026-11-02";
const event = (id: string, sourceId: string, start: string, end: string, allDay = false) => ({ id, calendar_source_id: sourceId, title: "Work", start_at: `${date}T${start}:00Z`, end_at: `${date}T${end}:00Z`, all_day: allDay, recurrence_rule: null, excluded_dates: [], participants: [], member_ids: [] }) as unknown as CalendarEvent;
const existing: ExistingShift = { key: "original-occurrence", eventId: "original", date, endDate: date, title: "Babysitter", start: "10:00", end: "15:00", allDay: false, startAt: `${date}T10:00:00Z`, splitFromEventId: null, splitFromDate: null, assignment: { kind: "other", name: "Sitter" } };
const proposal: ProposedShift = { id: "proposal", date, start: "10:00", end: "12:00", title: "Babysitter", assignment: existing.assignment, existing: { eventId: existing.eventId, occurrenceKey: existing.key, startAt: existing.startAt } };
const input = (): CoverageInput => ({ month: "2026-11", timeZone: "UTC", settings: { parents: [{ label: "Dad", sourceId: "dad", sourceName: "Dad work", health: "ok" }, { label: "Mom", sourceId: "mom", sourceName: "Mom work", health: "ok" }], bufferBefore: 0, bufferAfter: 0 }, workEvents: [[event("d", "dad", "09:00", "17:00")], [event("m", "mom", "10:00", "15:00")]], existing: [], draft: { shifts: [] }, lineage: {} });
const gaps = (i: CoverageInput) => confirmedCoverageGaps(computeScheduleCoverage(i), i.settings, i.month);

describe("confirmed inline schedule coverage gaps", () => {
  it("flags only uncovered parent overlap with configured buffers", () => {
    const i = input(); i.settings.bufferBefore = 30; i.settings.bufferAfter = 15;
    expect(gaps(i)[date]?.uncovered).toEqual([[570, 915]]);
    expect(gaps(i)["2026-11-03"]).toBeUndefined();
  });
  it("fully covered days have no indicator", () => {
    const i = input(); i.existing = [existing]; expect(gaps(i)).toEqual({});
  });
  it("latest unpublished edit replaces its original coverage", () => {
    const i = input(); i.existing = [existing]; i.draft.shifts = [proposal];
    expect(gaps(i)[date]?.uncovered).toEqual([[720, 900]]);
    i.draft.shifts = [{ ...proposal, end: "15:00" }]; expect(gaps(i)).toEqual({});
  });
  it("moving an unpublished shift uncovers the original date", () => {
    const i = input(); i.existing = [existing]; i.draft.shifts = [{ ...proposal, date: "2026-11-03", end: "15:00" }];
    expect(gaps(i)[date]?.uncovered).toEqual([[600, 900]]);
  });
  it("No Childcare Needed suppresses the red gap", () => {
    const i = input(); i.draft.coverage = { ignored: [], noCare: [date] }; expect(gaps(i)).toEqual({});
  });
  it.each(["hidden", "unavailable", "stale", "incomplete", "missing"] as const)("%s calendars cannot produce confirmed red gaps", health => {
    const i = input(); i.settings.parents[0].health = health; expect(gaps(i)).toEqual({});
  });
  it("an unverified external import month cannot produce red gaps", () => {
    const i = input(); i.settings.parents[0].range = null; expect(gaps(i)).toEqual({});
    i.settings.parents[0].range = { from: "2026-11-01", to: "2026-11-15" }; expect(gaps(i)).toEqual({});
  });
  it("all-day ambiguity suppresses a red gap on that date", () => {
    const i = input(); i.workEvents[0].push(event("all-day", "dad", "00:00", "23:59", true)); expect(gaps(i)).toEqual({});
  });
  it("unassigned draft shifts do not confirm coverage", () => {
    const i = input(); i.draft.shifts = [{ ...proposal, existing: undefined, end: "15:00", assignment: { kind: "none" } }];
    expect(gaps(i)[date]?.unassignedOnly).toEqual([[600, 900]]);
  });
  it("pending deletion removes coverage and undo restores it", () => {
    const i = input(); i.existing = [existing]; i.draft.removals = [{ ...proposal, end: "15:00" }];
    expect(gaps(i)[date]?.uncovered).toEqual([[600, 900]]);
    i.draft.removals = []; expect(gaps(i)).toEqual({});
  });
  it("published replacement identities cannot leave stale duplicate coverage", () => {
    const i = input(); i.existing = [{ ...existing, eventId: "replacement", key: "replacement-key" }];
    i.workEvents = [[event("d", "dad", "09:00", "17:00")], [event("m", "mom", "10:00", "15:00")]];
    i.draft.shifts = [{ ...proposal, existing: undefined, assignment: { kind: "none" } }];
    const result = computeScheduleCoverage(i, { proposal: "replacement" });
    expect(result.days.find(d => d.date === date)?.uncovered).toEqual([[600, 900]]);
  });
});