import { describe, expect, it } from "vitest";

import { remoteRecurringBodyIsStale, toGoogleTimes } from "../src/lib/google/mapping";

const TZ = "America/Los_Angeles";

// Monday 4-5 PM Los Angeles, weekly
const times = toGoogleTimes("2026-10-26T23:00:00.000Z", "2026-10-27T00:00:00.000Z", false, TZ);
const expected = {
  start: times.start,
  end: times.end,
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
};

describe("DST repair of already-linked recurring Google masters", () => {
  it("flags a stale fixed-offset master even when the link looks current", () => {
    const remote = {
      start: { dateTime: "2026-10-26T16:00:00-07:00", timeZone: "UTC" },
      end: { dateTime: "2026-10-26T17:00:00-07:00", timeZone: "UTC" },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
    };
    expect(remoteRecurringBodyIsStale(expected, remote)).toBe(true);
  });

  it("expects floating local wall clock plus the IANA household zone", () => {
    expect(expected.start).toEqual({ dateTime: "2026-10-26T16:00:00", timeZone: TZ });
    expect(expected.end).toEqual({ dateTime: "2026-10-26T17:00:00", timeZone: TZ });
  });

  it("treats a healthy master as healthy and is idempotent", () => {
    const healthy = { ...expected, recurrence: ["rrule:freq=weekly;byday=mo"] };
    expect(remoteRecurringBodyIsStale(expected, healthy)).toBe(false);
    expect(remoteRecurringBodyIsStale(expected, healthy)).toBe(false);
  });

  it("flags a differing recurrence rule", () => {
    expect(
      remoteRecurringBodyIsStale(expected, { ...expected, recurrence: ["RRULE:FREQ=DAILY"] }),
    ).toBe(true);
  });
});
