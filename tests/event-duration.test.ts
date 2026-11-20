import { describe, expect, it } from "vitest";
import { clampSameDayEnd, endAfterStartChange } from "../src/lib/event-duration";
import { payPeriodFor } from "../src/lib/timesheet-periods";
describe("shared duration and caregiver periods", () => {
  it("moves Nov 15 9 AM–1 PM to Nov 17 without changing its four-hour duration", () => {
    expect(endAfterStartChange("2026-11-15T17:00:00Z", "2026-11-15T21:00:00Z", "2026-11-17T17:00:00Z")).toBe("2026-11-17T21:00:00.000Z");
  });
  it("retains overnight and multi-day elapsed duration across DST", () => {
    expect(endAfterStartChange("2026-10-31T05:00:00Z", "2026-11-02T06:00:00Z", "2026-11-10T06:00:00Z")).toBe("2026-11-12T07:00:00.000Z");
  });
  it("uses the most recently edited end", () => {
    expect(endAfterStartChange("2026-11-15T17:00:00Z", "2026-11-15T23:00:00Z", "2026-11-17T17:00:00Z")).toBe("2026-11-17T23:00:00.000Z");
  });
  it("keeps a duration-preserved end that stays on the same day", () => {
    expect(clampSameDayEnd("2026-11-17", "2026-11-17T21:00")).toBe("21:00");
  });
  it("clamps an end that would cross midnight to 23:59 instead of refusing the start edit", () => {
    expect(clampSameDayEnd("2026-11-17", "2026-11-18T02:00")).toBe("23:59");
  });
  it("clamps a missing end to 23:59", () => {
    expect(clampSameDayEnd("2026-11-17", null)).toBe("23:59");
  });
  it("calculates weekly caregiver periods from their chosen anchor", () => {
    expect(payPeriodFor({ frequency: "weekly", anchor_date: "2026-11-09", semimonthly_first_end: 15 }, "2026-11-15")).toEqual({ start: "2026-11-09", end: "2026-11-15" });
  });
  it("calculates every-two-week caregiver periods from their chosen anchor", () => {
    expect(payPeriodFor({ frequency: "biweekly", anchor_date: "2026-11-09", semimonthly_first_end: 15 }, "2026-11-15")).toEqual({ start: "2026-11-09", end: "2026-11-22" });
  });
  it("uses household-compatible calendar-month periods", () => {
    expect(payPeriodFor({ frequency: "monthly", anchor_date: "2026-11-09", semimonthly_first_end: 15 }, "2026-11-15")).toEqual({ start: "2026-11-01", end: "2026-11-30" });
  });
});