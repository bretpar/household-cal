import { describe, it, expect } from "vitest";
import { computeCoverage, type CoverageSettings } from "@/lib/smart-coverage";
import type { CalendarEvent } from "@/lib/family-data";
import type { ExistingShift } from "@/lib/schedule-builder";

const tz = "America/Los_Angeles";
const ev = (id: string, start: string, end: string, src: string) => ({ id, calendar_source_id: src, title: "Work", start_at: start, end_at: end, all_day: false, recurrence_rule: null, excluded_dates: [], participants: [], member_ids: [] }) as unknown as CalendarEvent;
const settings = (over: Partial<CoverageSettings> = {}): CoverageSettings => ({ parents: [
  { label: "Dad", sourceId: "a", sourceName: "Dad work", health: "ok" }, { label: "Mom", sourceId: "b", sourceName: "Mom work", health: "ok" }], bufferBefore: 0, bufferAfter: 0, ...over });
// Nov 2 2026 is PST (UTC-8): 09:00 local = 17:00Z
const dad = [ev("d1", "2026-11-02T17:00:00Z", "2026-11-03T01:00:00Z", "a")]; // 09–17
const mom = [ev("m1", "2026-11-02T18:00:00Z", "2026-11-02T23:00:00Z", "b")]; // 10–15
const shift = (start: string, end: string, kind: "caregiver" | "none"): ExistingShift => ({ key: `k${start}`, eventId: "00000000-0000-4000-8000-000000000001", date: "2026-11-02", endDate: "2026-11-02", title: "Babysitter", start, end, allDay: false,
  assignment: kind === "none" ? { kind: "none" } : { kind: "caregiver", family_member_id: "00000000-0000-4000-8000-000000000009" }, startAt: "2026-11-02T18:00:00Z", splitFromEventId: null, splitFromDate: null });
const run = (o: Partial<Parameters<typeof computeCoverage>[0]> = {}) => computeCoverage({ month: "2026-11", timeZone: tz, settings: settings(), workEvents: [dad, mom], existing: [], draft: { shifts: [] }, lineage: {}, ...o }).days.find(d => d.date === "2026-11-02")!;

describe("smart coverage", () => {
  it("needs coverage only while both parents work, in household time", () => {
    const d = run(); expect(d.status).toBe("missing"); expect(d.suggestions.map(s => [s.start, s.end])).toEqual([["10:00", "15:00"]]);
  });
  it("applies buffers before and after the overlap", () => {
    expect(run({ settings: settings({ bufferBefore: 30, bufferAfter: 15 }) }).suggestions[0]).toMatchObject({ start: "09:30", end: "15:15" });
  });
  it("an assigned shift partially covers and only the gap is suggested", () => {
    const d = run({ existing: [shift("10:00", "12:00", "caregiver")] });
    expect(d.status).toBe("partial"); expect(d.suggestions.map(s => s.start)).toEqual(["12:00"]);
  });
  it("Unassigned shifts are not confirmed coverage but are not duplicated", () => {
    const d = run({ existing: [shift("10:00", "15:00", "none")] });
    expect(d.status).toBe("missing"); expect(d.suggestions).toEqual([]); expect(d.unassignedOnly).toEqual([[600, 900]]);
  });
  it("marks results incomplete when a work calendar is stale", () => {
    const s = settings(); s.parents[1].health = "stale";
    expect(computeCoverage({ month: "2026-11", timeZone: tz, settings: s, workEvents: [dad, mom], existing: [], draft: { shifts: [] }, lineage: {} }).complete).toBe(false);
  });
  it("No childcare needed suppresses suggestions for that date", () => {
    const d = run({ draft: { shifts: [], coverage: { ignored: [], noCare: ["2026-11-02"] } } });
    expect(d.status).toBe("no-care"); expect(d.suggestions).toEqual([]);
  });
});
