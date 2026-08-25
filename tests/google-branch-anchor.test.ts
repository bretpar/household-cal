import { describe, expect, it } from "vitest";
import { branchAnchoredTimes } from "../src/lib/google/mapping";

// shared series starts Monday 2026-08-31 17:00Z, one hour long
const start = "2026-08-31T17:00:00.000Z";
const end = "2026-08-31T18:00:00.000Z";
const durationOf = (t: { startAt: string; endAt: string }) =>
  new Date(t.endAt).getTime() - new Date(t.startAt).getTime();

describe("branch DTSTART anchoring", () => {
  it("keeps a Monday branch on the shared Monday start", () => {
    expect(branchAnchoredTimes(start, end, ["MO"])).toEqual({ startAt: start, endAt: end });
  });

  it("moves a Wednesday branch to the first Wednesday on/after the start", () => {
    const t = branchAnchoredTimes(start, end, ["WE"]);
    expect(t.startAt).toBe("2026-09-02T17:00:00.000Z");
    expect(new Date(t.startAt).getUTCDay()).toBe(3);
  });

  it("anchors a multi-day TU,TH branch to the first matching weekday", () => {
    expect(branchAnchoredTimes(start, end, ["TU", "TH"]).startAt).toBe("2026-09-01T17:00:00.000Z");
  });

  it("preserves duration and time of day when shifting", () => {
    const t = branchAnchoredTimes(start, end, ["FR"]);
    expect(durationOf(t)).toBe(durationOf({ startAt: start, endAt: end }));
    expect(t.startAt.slice(11)).toBe(start.slice(11));
    expect(t.endAt).toBe("2026-09-04T18:00:00.000Z");
  });

  it("shifts all-day branch dates by whole days", () => {
    const t = branchAnchoredTimes("2026-08-31T00:00:00.000Z", "2026-08-31T23:59:59.000Z", ["WE"]);
    expect(t.startAt.slice(0, 10)).toBe("2026-09-02");
    expect(t.endAt.slice(0, 10)).toBe("2026-09-02");
  });

  it("leaves non-branched recurring events untouched", () => {
    expect(branchAnchoredTimes(start, end, null)).toEqual({ startAt: start, endAt: end });
    expect(branchAnchoredTimes(start, end, [])).toEqual({ startAt: start, endAt: end });
  });
});
