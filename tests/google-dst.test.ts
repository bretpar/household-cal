import { describe, expect, it } from "vitest";
import { localWallClock, toGoogleTimes, fromGoogleTimes } from "@/lib/google/mapping";

const TZ = "America/Los_Angeles";

describe("google DST-safe times", () => {
  it("sends local wall clock before and after a DST transition", () => {
    // 9:00 AM PDT (Oct) and 9:00 AM PST (Nov) are different UTC instants
    const pdt = toGoogleTimes("2026-10-15T16:00:00.000Z", "2026-10-15T17:00:00.000Z", false, TZ);
    const pst = toGoogleTimes("2026-11-05T17:00:00.000Z", "2026-11-05T18:00:00.000Z", false, TZ);
    expect(pdt.start).toEqual({ dateTime: "2026-10-15T09:00:00", timeZone: TZ });
    expect(pst.start).toEqual({ dateTime: "2026-11-05T09:00:00", timeZone: TZ });
    expect(pdt.end?.dateTime).toBe("2026-10-15T10:00:00");
    expect(pst.end?.dateTime).toBe("2026-11-05T10:00:00");
  });

  it("preserves 7:45 AM coverage times and duration", () => {
    const t = toGoogleTimes("2026-11-10T15:45:00.000Z", "2026-11-10T16:30:00.000Z", false, TZ);
    expect(t.start?.dateTime).toBe("2026-11-10T07:45:00");
    expect(t.end?.dateTime).toBe("2026-11-10T08:30:00");
  });

  it("keeps all-day events unchanged", () => {
    const t = toGoogleTimes("2026-11-05T00:00:00.000Z", "2026-11-05T23:59:59.000Z", true, TZ);
    expect(t.start).toEqual({ date: "2026-11-05" });
    expect(t.end).toEqual({ date: "2026-11-06" });
  });

  it("imports offset-bearing google times as the same instant", () => {
    const imported = fromGoogleTimes({
      id: "x",
      start: { dateTime: "2026-11-05T09:00:00-08:00", timeZone: TZ },
      end: { dateTime: "2026-11-05T10:00:00-08:00", timeZone: TZ },
    } as never);
    expect(imported.start_at).toBe("2026-11-05T17:00:00.000Z");
    expect(imported.all_day).toBe(false);
    expect(localWallClock(imported.start_at, TZ)).toBe("2026-11-05T09:00:00");
  });
});
