import { describe, expect, it } from "vitest";

import {
  occurrenceWallClockDrifted,
  remoteRecurringBodyIsStale,
  remoteRecurringTimesAreAmbiguous,
  toGoogleTimes,
} from "../src/lib/google/mapping";

const TZ = "America/Los_Angeles";

// Monday 4-5 PM Los Angeles, weekly — the production case k36j3eluqfajsjq3s7o8eflae4
const times = toGoogleTimes("2026-10-26T23:00:00.000Z", "2026-10-27T00:00:00.000Z", false, TZ);
const expected = {
  start: times.start,
  end: times.end,
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
};

describe("DST health of an already-linked recurring master", () => {
  it("treats a fixed-offset master as ambiguous and stale", () => {
    const remote = {
      start: { dateTime: "2026-10-26T16:00:00-07:00", timeZone: "UTC" },
      end: { dateTime: "2026-10-26T17:00:00-07:00", timeZone: "UTC" },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
    };
    expect(remoteRecurringTimesAreAmbiguous(remote)).toBe(true);
    expect(remoteRecurringBodyIsStale(expected, remote)).toBe(true);
  });

  it("flags an expanded post-DST occurrence that drifted to 5 PM", () => {
    // Nov 2 expanded at the pre-DST offset: 5 PM local instead of 4 PM
    expect(
      occurrenceWallClockDrifted(
        expected.start?.dateTime,
        { dateTime: "2026-11-02T17:00:00-08:00", timeZone: TZ },
        TZ,
      ),
    ).toBe(true);
  });

  it("accepts a healthy post-DST occurrence and is idempotent", () => {
    const healthy = { dateTime: "2026-11-02T16:00:00-08:00", timeZone: TZ };
    expect(occurrenceWallClockDrifted(expected.start?.dateTime, healthy, TZ)).toBe(false);
    expect(occurrenceWallClockDrifted(expected.start?.dateTime, healthy, TZ)).toBe(false);
  });

  it("keeps a floating wall-clock + IANA master unambiguous and healthy", () => {
    expect(remoteRecurringTimesAreAmbiguous(expected)).toBe(false);
    expect(remoteRecurringBodyIsStale(expected, expected)).toBe(false);
  });
});
