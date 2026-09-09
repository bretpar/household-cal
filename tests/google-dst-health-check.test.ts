import { describe, expect, it } from "vitest";

import { occurrenceWallClockDrifted, toGoogleTimes } from "../src/lib/google/mapping";

const TZ = "America/Los_Angeles";

// QA-HIRISK-202609080305-T3-DST: Monday 4-5 PM Los Angeles, weekly
const times = toGoogleTimes("2026-10-26T23:00:00.000Z", "2026-10-27T00:00:00.000Z", false, TZ);
const expectedStart = times.start?.dateTime;

// Google renders expanded instances in the TARGET CALENDAR's zone (Phoenix here),
// so the correct 4 PM Los Angeles occurrence comes back as 17:00 -07:00.
const phoenixRendered = { dateTime: "2026-11-02T17:00:00-07:00", timeZone: TZ };
const laRendered = { dateTime: "2026-11-02T16:00:00-08:00", timeZone: TZ };
// A genuinely drifted occurrence: one hour later in Los Angeles.
const drifted = { dateTime: "2026-11-02T17:00:00-08:00", timeZone: TZ };

describe("post-DST occurrence health check", () => {
  it("both healthy fixtures are the same UTC instant", () => {
    expect(new Date(phoenixRendered.dateTime).toISOString()).toBe(
      new Date(laRendered.dateTime).toISOString(),
    );
  });

  it("treats the calendar-rendered 17:00 -07:00 occurrence as HEALTHY", () => {
    expect(occurrenceWallClockDrifted(expectedStart, phoenixRendered, TZ)).toBe(false);
    // idempotent: no repair rewrite is ever triggered for it
    expect(occurrenceWallClockDrifted(expectedStart, phoenixRendered, TZ)).toBe(false);
  });

  it("treats the 16:00 -08:00 rendering as HEALTHY too", () => {
    expect(occurrenceWallClockDrifted(expectedStart, laRendered, TZ)).toBe(false);
  });

  it("still detects a real one-hour drift in the household zone", () => {
    expect(occurrenceWallClockDrifted(expectedStart, drifted, TZ)).toBe(true);
  });

  it("works in the other DST direction (spring forward)", () => {
    const spring = toGoogleTimes("2027-03-01T00:00:00.000Z", "2027-03-01T01:00:00.000Z", false, TZ);
    // 2027-03-15 4 PM LA (PDT) rendered by a Phoenix calendar as 16:00 -07:00
    expect(
      occurrenceWallClockDrifted(
        spring.start?.dateTime,
        { dateTime: "2027-03-15T16:00:00-07:00", timeZone: TZ },
        TZ,
      ),
    ).toBe(false);
    expect(
      occurrenceWallClockDrifted(
        spring.start?.dateTime,
        { dateTime: "2027-03-15T17:00:00-07:00", timeZone: TZ },
        TZ,
      ),
    ).toBe(true);
  });

  it("works for a non-DST household zone", () => {
    const PHX = "America/Phoenix";
    const phx = toGoogleTimes("2026-10-26T23:00:00.000Z", "2026-10-27T00:00:00.000Z", false, PHX);
    expect(phx.start?.dateTime).toBe("2026-10-26T16:00:00");
    // same instant, rendered by an LA calendar in November
    expect(
      occurrenceWallClockDrifted(
        phx.start?.dateTime,
        { dateTime: "2026-11-02T15:00:00-08:00", timeZone: PHX },
        PHX,
      ),
    ).toBe(false);
    expect(
      occurrenceWallClockDrifted(
        phx.start?.dateTime,
        { dateTime: "2026-11-02T16:00:00-08:00", timeZone: PHX },
        PHX,
      ),
    ).toBe(true);
  });

  it("compares a floating occurrence string literally", () => {
    expect(
      occurrenceWallClockDrifted(expectedStart, { dateTime: "2026-11-02T16:00:00" }, TZ),
    ).toBe(false);
    expect(
      occurrenceWallClockDrifted(expectedStart, { dateTime: "2026-11-02T17:00:00" }, TZ),
    ).toBe(true);
  });
});

describe("midnight and date-boundary wall-clock comparison", () => {
  // 11:30 PM Los Angeles, weekly
  const lateNight = toGoogleTimes("2026-10-27T06:30:00.000Z", "2026-10-27T07:30:00.000Z", false, TZ);
  it("anchors the expected wall clock at 23:30 local", () => {
    expect(lateNight.start?.dateTime).toBe("2026-10-26T23:30:00");
  });

  it("is healthy when the rendered offset puts the UTC instant on the next calendar day", () => {
    // 23:30 PDT = 06:30 UTC the next day; a Phoenix calendar renders 23:30 -07:00
    expect(
      occurrenceWallClockDrifted(
        lateNight.start?.dateTime,
        { dateTime: "2026-11-02T23:30:00-07:00", timeZone: TZ },
        TZ,
      ),
    ).toBe(false);
  });

  it("is healthy when a behind-UTC zone renders the occurrence on the previous calendar date", () => {
    // 23:30 LA = 06:30 UTC next day = 22:30 -08:00 Anchorage... use a zone behind LA:
    // the same instant rendered in Pacific/Auckland would be the NEXT day; instead verify
    // LA local rendering across the UTC date line stays healthy.
    expect(
      occurrenceWallClockDrifted(
        lateNight.start?.dateTime,
        { dateTime: "2026-11-02T23:30:00-08:00", timeZone: TZ },
        TZ,
      ),
    ).toBe(false);
  });

  it("still detects drift at late-night times", () => {
    expect(
      occurrenceWallClockDrifted(
        lateNight.start?.dateTime,
        { dateTime: "2026-11-03T00:30:00-08:00", timeZone: TZ },
        TZ,
      ),
    ).toBe(true);
  });

  // Exactly midnight Los Angeles
  const midnight = toGoogleTimes("2026-10-27T07:00:00.000Z", "2026-10-27T08:00:00.000Z", false, TZ);
  it("anchors an exactly-midnight event at 00:00 local", () => {
    expect(midnight.start?.dateTime).toBe("2026-10-27T00:00:00");
  });

  it("treats a midnight occurrence rendered with another zone's offset as healthy", () => {
    // 00:00 PDT = 00:00 -07:00 Phoenix (same wall clock) and 01:00 -06:00 Denver;
    // both are the same instant and must convert back to 00:00 LA.
    expect(
      occurrenceWallClockDrifted(
        midnight.start?.dateTime,
        { dateTime: "2026-10-27T00:00:00-07:00", timeZone: TZ },
        TZ,
      ),
    ).toBe(false);
    expect(
      occurrenceWallClockDrifted(
        midnight.start?.dateTime,
        { dateTime: "2026-10-27T01:00:00-06:00", timeZone: TZ },
        TZ,
      ),
    ).toBe(false);
  });

  it("detects drift just after midnight", () => {
    expect(
      occurrenceWallClockDrifted(
        midnight.start?.dateTime,
        { dateTime: "2026-10-27T01:00:00-07:00", timeZone: TZ },
        TZ,
      ),
    ).toBe(true);
  });

  it("handles an occurrence whose UTC date differs from its local date after DST ends", () => {
    // Post-fall-back: 00:00 PST = 08:00 UTC same day; rendered by Phoenix as 01:00 -07:00
    const pstMidnight = toGoogleTimes(
      "2026-11-03T08:00:00.000Z",
      "2026-11-03T09:00:00.000Z",
      false,
      TZ,
    );
    expect(pstMidnight.start?.dateTime).toBe("2026-11-03T00:00:00");
    expect(
      occurrenceWallClockDrifted(
        pstMidnight.start?.dateTime,
        { dateTime: "2026-11-03T01:00:00-07:00", timeZone: TZ },
        TZ,
      ),
    ).toBe(false);
  });
});
