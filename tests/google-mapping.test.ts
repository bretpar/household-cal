import { describe, expect, it } from "vitest";

import {
  computeBranches,
  fromGoogleRecurrence,
  googleTitle,
  shouldApplyGoogleChange,
  stripGeneratedSuffix,
  syncWindow,
  toGoogleRecurrence,
} from "@/lib/google/mapping";

describe("recurrence branches", () => {
  it("keeps a simple event as one Google series", () => {
    const branches = computeBranches({
      recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,TU",
      participants: [{ member_id: "b", weekdays: null }],
      member_ids: ["b"],
    });
    expect(branches).toEqual([{ key: "", weekdays: null, memberIds: ["b"] }]);
  });

  it("splits School into a Monday branch and a Tue-Thu branch", () => {
    const branches = computeBranches({
      recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH",
      participants: [
        { member_id: "b", weekdays: ["MO", "TU", "WE", "TH"] },
        { member_id: "e", weekdays: ["TU", "WE", "TH"] },
      ],
      member_ids: ["b", "e"],
    });
    expect(branches).toHaveLength(2);
    expect(branches[0]).toEqual({ key: "MO", weekdays: ["MO"], memberIds: ["b"] });
    expect(branches[1]).toEqual({
      key: "TU,WE,TH",
      weekdays: ["TU", "WE", "TH"],
      memberIds: ["b", "e"],
    });
  });

  it("ignores per-person days on a non-recurring event", () => {
    const branches = computeBranches({
      recurrence_rule: null,
      participants: [{ member_id: "b", weekdays: ["MO"] }],
      member_ids: ["b"],
    });
    expect(branches[0]?.weekdays).toBeNull();
  });
});

describe("google titles", () => {
  it("appends member initials", () => {
    expect(googleTitle("School", ["B", "E"])).toBe("School - B & E");
    expect(googleTitle("School", ["B"])).toBe("School - B");
    expect(googleTitle("School", [])).toBe("School");
  });

  it("does not re-read assignments out of an externally renamed title", () => {
    expect(stripGeneratedSuffix("Late Start", ["B", "E"])).toBe("Late Start");
    expect(stripGeneratedSuffix("School - B & E", ["B", "E"])).toBe("School");
  });
});

describe("recurrence rule conversion", () => {
  it("round-trips a weekly rule with an end date", () => {
    const lines = toGoogleRecurrence("FREQ=WEEKLY;BYDAY=TU,TH", "2026-12-14", []);
    expect(lines?.[0]).toContain("RRULE:FREQ=WEEKLY;BYDAY=TU,TH");
    const parsed = fromGoogleRecurrence(lines);
    expect(parsed.rule).toContain("FREQ=WEEKLY");
    expect(parsed.until).toBe("2026-12-14");
  });

  it("reads excluded dates back from EXDATE", () => {
    const parsed = fromGoogleRecurrence(["RRULE:FREQ=DAILY", "EXDATE;VALUE=DATE:20260310"]);
    expect(parsed.excludedDates).toContain("2026-03-10");
  });
});

describe("conflict resolution", () => {
  const base = {
    google_etag: '"abc"',
    google_updated_at: "2026-03-01T10:00:00.000Z",
    last_source: "app" as const,
    last_pushed_at: "2026-03-01T10:00:00.000Z",
  };

  it("applies anything for a brand-new link", () => {
    expect(shouldApplyGoogleChange(null, {}, null)).toBe(true);
  });

  it("ignores Google echoing our own push back", () => {
    expect(shouldApplyGoogleChange(base, { etag: '"abc"' }, null)).toBe(false);
  });

  it("ignores a delayed Google update older than the app change", () => {
    expect(
      shouldApplyGoogleChange(
        base,
        { etag: '"new"', updated: "2026-03-01T09:00:00.000Z" },
        "2026-03-01T10:00:00.000Z",
      ),
    ).toBe(false);
  });

  it("applies a genuinely newer external edit", () => {
    expect(
      shouldApplyGoogleChange(
        base,
        { etag: '"new"', updated: "2026-03-02T10:00:00.000Z" },
        "2026-03-01T10:00:00.000Z",
      ),
    ).toBe(true);
  });
});

describe("sync window", () => {
  it("imports three months back on first connection", () => {
    const now = new Date("2026-06-15T00:00:00.000Z");
    const initial = syncWindow(now, true);
    expect(initial.timeMin.slice(0, 7)).toBe("2026-03");
    expect(initial.timeMax.slice(0, 7)).toBe("2026-09");
  });

  it("stays near the present for ongoing work", () => {
    const ongoing = syncWindow(new Date("2026-06-15T00:00:00.000Z"), false);
    expect(ongoing.timeMin.slice(0, 7)).toBe("2026-05");
    expect(ongoing.timeMax.slice(0, 7)).toBe("2026-09");
  });
});
