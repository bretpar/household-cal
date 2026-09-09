import { describe, expect, it } from "vitest";

import { remoteRecurringBodyIsStale, toGoogleTimes } from "../src/lib/google/mapping";

const TZ = "America/Los_Angeles";
const MASTER_ID = "k36j3eluqfajsjq3s7o8eflae4";

// Monday 4-5 PM Los Angeles, weekly — the production DST case
const times = toGoogleTimes("2026-10-26T23:00:00.000Z", "2026-10-27T00:00:00.000Z", false, TZ);
const expected = {
  start: times.start,
  end: times.end,
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261206T235959Z"],
};

/**
 * Mirrors the reconcile execution step: a STALE classification PATCHes the
 * already-generated body onto the SAME Google master; a HEALTHY one writes
 * nothing.
 */
function reconcileOnce(
  remote: typeof expected,
  writes: { method: string; id: string; body: unknown }[],
) {
  if (!remoteRecurringBodyIsStale(expected, remote)) return { repaired: 0 };
  writes.push({ method: "patch", id: MASTER_ID, body: expected });
  return { repaired: 1 };
}

describe("DST repair execution in reconcile", () => {
  const stale = {
    start: { dateTime: "2026-10-26T16:00:00-07:00", timeZone: "UTC" },
    end: { dateTime: "2026-10-26T17:00:00-07:00", timeZone: "UTC" },
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261206T235959Z"],
  };

  it("classifies the production master as STALE", () => {
    expect(remoteRecurringBodyIsStale(expected, stale)).toBe(true);
  });

  it("executes exactly one patch on the same Google master with the generated body", () => {
    const writes: { method: string; id: string; body: unknown }[] = [];
    expect(reconcileOnce(stale, writes).repaired).toBe(1);
    expect(writes).toEqual([
      {
        method: "patch",
        id: MASTER_ID,
        body: {
          start: { dateTime: "2026-10-26T16:00:00", timeZone: TZ },
          end: { dateTime: "2026-10-26T17:00:00", timeZone: TZ },
          recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261206T235959Z"],
        },
      },
    ]);
  });

  it("performs no further write once the master is healthy", () => {
    const writes: { method: string; id: string; body: unknown }[] = [];
    reconcileOnce(stale, writes);
    // Google now returns what we patched
    expect(reconcileOnce(expected, writes).repaired).toBe(0);
    expect(reconcileOnce(expected, writes).repaired).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.id).toBe(MASTER_ID);
  });
});
