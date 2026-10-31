import { describe, expect, it } from "vitest";
import { DEFAULT_PAY_SETTINGS, payPeriodFor, schedulePreservesPeriod } from "../src/lib/timesheet-periods";
import { localDateKey } from "../src/lib/google/occurrence";

describe("Timesheet schedule history protection", () => {
  const settings = { ...DEFAULT_PAY_SETTINGS, frequency: "biweekly" as const, anchor_date: "2026-10-04" };
  it("keeps identical historical boundaries when the known anchor moves by whole periods", () => {
    expect(schedulePreservesPeriod({ ...settings, anchor_date: "2026-11-01" }, { start: "2026-10-18", end: "2026-10-31" })).toBe(true);
  });
  it("rejects a schedule that moves a saved period start", () => {
    expect(schedulePreservesPeriod({ ...settings, anchor_date: "2026-10-05" }, { start: "2026-10-18", end: "2026-10-31" })).toBe(false);
  });
  it("rejects a frequency that changes a saved period end", () => {
    expect(schedulePreservesPeriod({ ...settings, frequency: "weekly" }, { start: "2026-10-18", end: "2026-10-31" })).toBe(false);
  });
  it("advances display periods in household time without changing the persisted anchor", () => {
    const today = localDateKey("2026-11-01T03:22:00Z", "America/Los_Angeles");
    expect(today).toBe("2026-10-31");
    expect(payPeriodFor(settings, today ?? "")).toEqual({ start: "2026-10-18", end: "2026-10-31" });
    expect(payPeriodFor(settings, today ?? "", 1)).toEqual({ start: "2026-11-01", end: "2026-11-14" });
    expect(payPeriodFor(settings, "2026-11-01")).toEqual({ start: "2026-11-01", end: "2026-11-14" });
    expect(settings.anchor_date).toBe("2026-10-04");
  });
});