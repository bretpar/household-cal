import { describe, expect, it } from "vitest";

import {
  occurrenceWallClockDrifted,
  remoteRecurringTimesAreAmbiguous,
  toGoogleTimes,
} from "../src/lib/google/mapping";

const TZ = "America/Los_Angeles";
const MASTER_ID = "k36j3eluqfajsjq3s7o8eflae4";

// QA-HIRISK-202609080305-T3-DST: Monday 4-5 PM Los Angeles, weekly
const times = toGoogleTimes("2026-10-26T23:00:00.000Z", "2026-10-27T00:00:00.000Z", false, TZ);
const expectedStart = times.start?.dateTime;

const badInstance = { dateTime: "2026-11-02T17:00:00-07:00", timeZone: TZ };
const goodInstance = { dateTime: "2026-11-02T16:00:00-08:00", timeZone: TZ };

describe("post-DST occurrence health check", () => {
  it("both fixture instances are the same UTC instant", () => {
    expect(new Date(badInstance.dateTime).toISOString()).toBe(
      new Date(goodInstance.dateTime).toISOString(),
    );
  });

  it("classifies the 17:00 -07:00 expansion as STALE", () => {
    expect(occurrenceWallClockDrifted(expectedStart, badInstance, TZ)).toBe(true);
  });

  it("classifies the 16:00 -08:00 expansion as HEALTHY and is idempotent", () => {
    expect(occurrenceWallClockDrifted(expectedStart, goodInstance, TZ)).toBe(false);
    expect(occurrenceWallClockDrifted(expectedStart, goodInstance, TZ)).toBe(false);
  });

  it("repairs the same Google master in place with floating local time + IANA zone", () => {
    const stale = occurrenceWallClockDrifted(expectedStart, badInstance, TZ);
    const remote = {
      start: { dateTime: "2026-10-26T16:00:00-07:00", timeZone: "UTC" },
      end: { dateTime: "2026-10-26T17:00:00-07:00", timeZone: "UTC" },
    };
    expect(remoteRecurringTimesAreAmbiguous(remote)).toBe(true);

    const patched: { id: string; body: unknown }[] = [];
    if (stale) {
      patched.push({
        id: MASTER_ID,
        body: {
          start: times.start,
          end: times.end,
          recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
        },
      });
    }
    expect(patched).toEqual([
      {
        id: MASTER_ID,
        body: {
          start: { dateTime: "2026-10-26T16:00:00", timeZone: TZ },
          end: { dateTime: "2026-10-26T17:00:00", timeZone: TZ },
          recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
        },
      },
    ]);
  });
});
