import { describe, expect, it } from "vitest";
import { computeCoverage, importRange, monthInRange, type CoverageSettings } from "@/lib/smart-coverage";
import type { CalendarEvent } from "@/lib/family-data";

const settings = (range?: { from: string; to: string } | null): CoverageSettings => ({ bufferBefore: 0, bufferAfter: 0, parents: [
  { label: "Dad", sourceId: "a", sourceName: "Dad Work", health: "ok", range },
  { label: "Mom", sourceId: "b", sourceName: "Mom Work", health: "ok", range: undefined }] });
const draft = { month: "2026-12", shifts: [] } as never;
const run = (s: CoverageSettings, work: [CalendarEvent[], CalendarEvent[]] = [[], []]) =>
  computeCoverage({ month: "2026-12", timeZone: "UTC", settings: s, workEvents: work, existing: [], draft, lineage: new Map() as never });

describe("import range completeness", () => {
  it("Google synced Nov 10 covers Oct 11–Feb 9 only", () => {
    expect(importRange({ provider: "google", last_synced_at: "2026-11-10T12:00:00Z" })).toEqual({ from: "2026-10-11", to: "2027-02-09" });
    expect(monthInRange("2026-12", { from: "2026-10-11", to: "2027-02-09" })).toBe(true);
    expect(monthInRange("2027-03", { from: "2026-10-11", to: "2027-02-09" })).toBe(false);
  });
  it("month outside the imported range is incomplete even when freshly synced", () => {
    const r = run(settings({ from: "2027-01-01", to: "2027-06-01" }));
    expect(r.complete).toBe(false);
    expect(r.problems[0]).toMatch(/hasn't imported events for this month/);
  });
  it("never-synced external source has no verified range", () => {
    expect(importRange({ provider: "ics", last_synced_at: null })).toBeNull();
    expect(run(settings(null)).complete).toBe(false);
  });
});

describe("all-day work events", () => {
  it("flags the day for manual review without timed overlap and warns", () => {
    const ev = { id: "e1", title: "Conference", calendar_source_id: "a", start_at: "2026-12-08T00:00:00Z", end_at: "2026-12-09T00:00:00Z", all_day: true, recurrence_rule: null, excluded_dates: [], participants: [], member_ids: [] } as unknown as CalendarEvent;
    const r = run(settings(undefined), [[ev], []]);
    const day = r.days.find(d => d.date === "2026-12-08")!;
    expect(day.status).toBe("review");
    expect(day.suggestions).toEqual([]);
    expect(r.complete).toBe(false);
    expect(r.problems.some(p => /all-day work events/.test(p))).toBe(true);
  });
});
