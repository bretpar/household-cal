import { describe, expect, it } from "vitest";
import { branchAnchoredTimes, branchPushWeekdays, toGoogleRecurrence } from "@/lib/google/mapping";
import type { WeekdayCode } from "@/lib/family-data";

// QA-T4R-ADD-202801031600: Monday Jan 3 2028 4 PM Los Angeles == Jan 4 00:00 UTC,
// so anchoring on the UTC weekday (Tuesday) used to land Dad on a Sunday and
// Mom on a Tuesday.
const TZ = "America/Los_Angeles";
const START = "2028-01-04T00:00:00.000Z";
const END = "2028-01-04T01:00:00.000Z";
const RULE = "FREQ=WEEKLY;BYDAY=MO,WE";

function localDay(instant: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

function branchPush(weekdays: WeekdayCode[]) {
  const push = branchPushWeekdays(weekdays, RULE);
  return {
    anchored: branchAnchoredTimes(START, END, push, TZ),
    recurrence: toGoogleRecurrence(RULE, push, null, []),
  };
}

describe("A. parent start weekday does not match the Dad branch", () => {
  // Sunday Jan 2 2028 4 PM local
  const dad = (() => {
    const push = branchPushWeekdays(["MO"] as WeekdayCode[], RULE);
    return {
      anchored: branchAnchoredTimes("2028-01-03T00:00:00.000Z", "2028-01-03T01:00:00.000Z", push, TZ),
      recurrence: toGoogleRecurrence(RULE, push, null, []),
    };
  })();

  it("anchors the Dad branch on the first local Monday", () => {
    expect(localDay(dad.anchored.startAt)).toContain("2028-01-03");
    expect(localDay(dad.anchored.startAt)).toContain("Mon");
  });

  it("emits no occurrence on the original non-Monday start date", () => {
    expect(localDay(dad.anchored.startAt)).not.toContain("2028-01-02");
    expect(localDay(dad.anchored.startAt)).not.toContain("Sun");
    expect(dad.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
  });

  it("keeps the intended wall-clock time and duration", () => {
    expect(dad.anchored.startAt.slice(11)).toBe("00:00:00.000Z");
    expect(new Date(dad.anchored.endAt).getTime() - new Date(dad.anchored.startAt).getTime()).toBe(
      3600000,
    );
  });
});

describe("B. adding Mom [WE] to Dad [MO]", () => {
  const dad = branchPush(["MO"]);
  const mom = branchPush(["WE"]);

  it("anchors the Mom branch on the first local Wednesday", () => {
    expect(localDay(mom.anchored.startAt)).toContain("2028-01-05");
    expect(localDay(mom.anchored.startAt)).toContain("Wed");
    expect(mom.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=WE"]);
  });

  it("emits no preceding Tuesday occurrence", () => {
    expect(localDay(mom.anchored.startAt)).not.toContain("Tue");
    expect(localDay(mom.anchored.startAt)).not.toContain("2028-01-04");
  });

  it("leaves the Dad branch Monday-only", () => {
    expect(localDay(dad.anchored.startAt)).toContain("Mon");
    expect(dad.recurrence?.join(" ")).not.toContain("SU");
  });

  it("is idempotent on a second reconciliation", () => {
    expect(branchPush(["MO"])).toEqual(dad);
    expect(branchPush(["WE"])).toEqual(mom);
    expect(branchAnchoredTimes(mom.anchored.startAt, mom.anchored.endAt, ["WE"], TZ)).toEqual(
      mom.anchored,
    );
  });
});

describe("all-day branches keep date-based anchoring", () => {
  it("shifts whole days without a zone", () => {
    const t = branchAnchoredTimes("2028-01-03T00:00:00.000Z", "2028-01-03T23:59:59.000Z", ["WE"]);
    expect(t.startAt.slice(0, 10)).toBe("2028-01-05");
  });
});
