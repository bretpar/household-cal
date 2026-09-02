import { describe, expect, it } from "vitest";
import { localDateKey, seriesCoversDate } from "@/lib/google/occurrence";

const tz = "America/Los_Angeles";

describe("confirmed recurring instance coverage", () => {
  const wedOnly = {
    startAt: "2026-09-02T14:30:00+00:00",
    recurrenceRule: "FREQ=WEEKLY",
    recurrenceUntil: null,
    excludedDates: null,
    timeZone: tz,
  };

  it("covers the Wednesday the series is anchored to", () => {
    expect(seriesCoversDate(wedOnly, "2026-09-02")).toBe(true);
    expect(seriesCoversDate(wedOnly, "2026-09-09")).toBe(true);
  });

  it("does not cover Thursday when BYDAY lacks TH", () => {
    expect(seriesCoversDate(wedOnly, "2026-09-03")).toBe(false);
  });

  it("covers Thursday once BYDAY includes TH", () => {
    expect(
      seriesCoversDate({ ...wedOnly, recurrenceRule: "FREQ=WEEKLY;BYDAY=WE,TH" }, "2026-09-03"),
    ).toBe(true);
  });

  it("treats an excluded day as not covered", () => {
    expect(seriesCoversDate({ ...wedOnly, excludedDates: ["2026-09-09"] }, "2026-09-09")).toBe(false);
  });

  it("resolves instance dates in the household timezone", () => {
    expect(localDateKey("2026-09-03T14:30:00Z", tz)).toBe("2026-09-03");
  });
});
