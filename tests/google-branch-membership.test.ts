import { describe, expect, it } from "vitest";

import {
  branchPushWeekdays,
  canonicalRecurrenceRule,
  computeBranches,
  toGoogleRecurrence,
  branchAnchoredTimes,
} from "../src/lib/google/mapping";
import type { WeekdayCode } from "../src/lib/family-data";

/** Fixture start weekday is a Sunday, so a stale SU would surface as an extra card. */
const SUNDAY_START = "2027-02-07T16:00:00.000Z";
const SUNDAY_END = "2027-02-07T17:00:00.000Z";
const STALE_RULE = "FREQ=WEEKLY;BYDAY=MO,SU,WE";

function branchesFor(rule: string | null, weekdays: Record<string, WeekdayCode[]>) {
  const ids = Object.keys(weekdays);
  return computeBranches({
    recurrence_rule: rule,
    participants: ids.map((id) => ({ member_id: id, weekdays: weekdays[id]! })),
    member_ids: ids,
  });
}

describe("removing a person from a per-person recurring event", () => {
  const weekdays = { dad: ["MO"] as WeekdayCode[] };

  it("keeps exactly the remaining member's weekday in the rule", () => {
    const rule = canonicalRecurrenceRule(STALE_RULE, weekdays);
    expect(rule).toBe("FREQ=WEEKLY;BYDAY=MO");
  });

  it("leaves exactly one Dad branch and no Mom branch", () => {
    const rule = canonicalRecurrenceRule(STALE_RULE, weekdays)!;
    const branches = branchesFor(rule, weekdays);
    expect(branches).toEqual([{ key: "MO", weekdays: ["MO"], memberIds: ["dad"] }]);
  });

  it("pushes no stale Sunday occurrence", () => {
    const rule = canonicalRecurrenceRule(STALE_RULE, weekdays)!;
    const branch = branchesFor(rule, weekdays)[0]!;
    const push = branchPushWeekdays(branch.weekdays, rule);
    const anchored = branchAnchoredTimes(SUNDAY_START, SUNDAY_END, push);
    expect(anchored.startAt.slice(0, 10)).toBe("2027-02-08");
    expect(toGoogleRecurrence(rule, push, null, [])).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
  });

  it("is idempotent on a second reconciliation", () => {
    const once = canonicalRecurrenceRule(STALE_RULE, weekdays)!;
    const twice = canonicalRecurrenceRule(once, weekdays)!;
    expect(twice).toBe(once);
    expect(branchesFor(twice, weekdays)).toEqual(branchesFor(once, weekdays));
  });
});

describe("adding a person to a Dad-only recurring event", () => {
  const weekdays = { dad: ["MO"] as WeekdayCode[], mom: ["WE"] as WeekdayCode[] };

  it("rebuilds the rule as MO,WE with no stale Sunday", () => {
    expect(canonicalRecurrenceRule("FREQ=WEEKLY;BYDAY=MO,SU", weekdays)).toBe(
      "FREQ=WEEKLY;BYDAY=MO,WE",
    );
  });

  it("reuses the Dad branch and adds exactly one Mom branch", () => {
    const rule = canonicalRecurrenceRule("FREQ=WEEKLY;BYDAY=MO,SU", weekdays)!;
    const branches = branchesFor(rule, weekdays);
    expect(branches).toEqual([
      { key: "MO", weekdays: ["MO"], memberIds: ["dad"] },
      { key: "WE", weekdays: ["WE"], memberIds: ["mom"] },
    ]);
    // the Dad branch key is unchanged, so its existing Google link is reused
    const before = branchesFor("FREQ=WEEKLY;BYDAY=MO", { dad: ["MO"] as WeekdayCode[] });
    expect(before[0]!.key).toBe(branches[0]!.key);
  });

  it("emits one Google series per branch, none on Sunday", () => {
    const rule = canonicalRecurrenceRule("FREQ=WEEKLY;BYDAY=MO,SU", weekdays)!;
    const lines = branchesFor(rule, weekdays).map(
      (b) => toGoogleRecurrence(rule, branchPushWeekdays(b.weekdays, rule), null, [])?.[0],
    );
    expect(lines).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO", "RRULE:FREQ=WEEKLY;BYDAY=WE"]);
    expect(lines.join(" ")).not.toContain("SU");
  });

  it("is idempotent on a second reconciliation", () => {
    const once = canonicalRecurrenceRule("FREQ=WEEKLY;BYDAY=MO,SU", weekdays)!;
    expect(canonicalRecurrenceRule(once, weekdays)).toBe(once);
    expect(branchesFor(once, weekdays)).toEqual(branchesFor(once, weekdays));
  });
});

describe("events without per-person days", () => {
  it("keeps the stored rule untouched", () => {
    expect(canonicalRecurrenceRule("FREQ=WEEKLY;BYDAY=SU", {})).toBe("FREQ=WEEKLY;BYDAY=SU");
    expect(canonicalRecurrenceRule(null, { dad: ["MO"] })).toBeNull();
  });
});
