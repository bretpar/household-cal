import { describe, expect, it } from "vitest";
import { remoteRecurringBodyIsStale } from "../src/lib/google/mapping";

const RRULE = ["RRULE:FREQ=WEEKLY;BYDAY=MO"];

const expected = {
  start: { dateTime: "2026-10-26T16:00:00", timeZone: "America/Los_Angeles" },
  end: { dateTime: "2026-10-26T17:00:00", timeZone: "America/Los_Angeles" },
  recurrence: RRULE,
};

describe("remoteRecurringBodyIsStale", () => {
  it("treats an offset-bearing echo of the same local time as healthy", () => {
    expect(
      remoteRecurringBodyIsStale(expected, {
        start: { dateTime: "2026-10-26T16:00:00-07:00", timeZone: "America/Los_Angeles" },
        end: { dateTime: "2026-10-26T17:00:00-07:00", timeZone: "America/Los_Angeles" },
        recurrence: RRULE,
      }),
    ).toBe(false);
  });

  it("treats a foreign-calendar rendering of the same instant as healthy", () => {
    // Phoenix-rendered instant for 16:00 Los Angeles after fall back
    expect(
      remoteRecurringBodyIsStale(
        {
          start: { dateTime: "2026-11-02T16:00:00", timeZone: "America/Los_Angeles" },
          end: { dateTime: "2026-11-02T17:00:00", timeZone: "America/Los_Angeles" },
          recurrence: RRULE,
        },
        {
          start: { dateTime: "2026-11-02T17:00:00-07:00", timeZone: "America/Los_Angeles" },
          end: { dateTime: "2026-11-02T18:00:00-07:00", timeZone: "America/Los_Angeles" },
          recurrence: RRULE,
        },
      ),
    ).toBe(false);
  });

  it("still flags a real one-hour wall-clock shift", () => {
    expect(
      remoteRecurringBodyIsStale(expected, {
        start: { dateTime: "2026-10-26T17:00:00-07:00", timeZone: "America/Los_Angeles" },
        end: { dateTime: "2026-10-26T18:00:00-07:00", timeZone: "America/Los_Angeles" },
        recurrence: RRULE,
      }),
    ).toBe(true);
  });

  it("still flags a timezone mismatch", () => {
    expect(
      remoteRecurringBodyIsStale(expected, {
        start: { dateTime: "2026-10-26T16:00:00-07:00", timeZone: "America/Phoenix" },
        end: { dateTime: "2026-10-26T17:00:00-07:00", timeZone: "America/Phoenix" },
        recurrence: RRULE,
      }),
    ).toBe(true);
  });

  it("still flags a missing or non-IANA timezone", () => {
    expect(
      remoteRecurringBodyIsStale(expected, {
        start: { dateTime: "2026-10-26T16:00:00-07:00" },
        end: { dateTime: "2026-10-26T17:00:00-07:00" },
        recurrence: RRULE,
      }),
    ).toBe(true);
  });

  it("still flags a recurrence mismatch", () => {
    expect(
      remoteRecurringBodyIsStale(expected, {
        start: { dateTime: "2026-10-26T16:00:00-07:00", timeZone: "America/Los_Angeles" },
        end: { dateTime: "2026-10-26T17:00:00-07:00", timeZone: "America/Los_Angeles" },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
      }),
    ).toBe(true);
  });

  it("keeps identical floating bodies healthy", () => {
    expect(remoteRecurringBodyIsStale(expected, expected)).toBe(false);
  });
});
