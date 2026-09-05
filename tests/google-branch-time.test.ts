import { describe, expect, it } from "vitest";
import {
  branchTimeReview,
  seriesPatchFromGoogle,
  type GoogleEvent,
} from "@/lib/google/mapping";

const local = {
  start_at: "2026-09-02T23:00:00.000Z", // 4 PM local
  end_at: "2026-09-03T00:00:00.000Z",
  all_day: false,
};

function google(startAt: string, endAt: string, extra: Partial<GoogleEvent> = {}): GoogleEvent {
  return {
    id: "g1",
    summary: "Swim",
    start: { dateTime: startAt },
    end: { dateTime: endAt },
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
    ...extra,
  };
}

describe("branch-wide Google time edits", () => {
  it("flags a branch-only series time change", () => {
    const review = branchTimeReview({
      local: { branchKey: "WE", ...local },
      google: google("2026-09-02T17:00:00-07:00", "2026-09-02T18:00:00-07:00"),
    });
    expect(review).toContain("Branch-specific series time edits");
  });

  it("applies symmetrically to the other branch", () => {
    const review = branchTimeReview({
      local: { branchKey: "MO", ...local },
      google: google("2026-08-31T17:00:00-07:00", "2026-08-31T18:00:00-07:00"),
    });
    expect(review).toBeTruthy();
  });

  it("ignores the branch anchor date shift", () => {
    const review = branchTimeReview({
      local: { branchKey: "WE", ...local },
      google: google("2026-09-02T16:00:00-07:00", "2026-09-02T17:00:00-07:00"),
    });
    expect(review).toBeNull();
  });

  it("leaves shared (non-branch) series and single occurrences alone", () => {
    expect(
      branchTimeReview({
        local: { branchKey: "", ...local },
        google: google("2026-09-02T17:00:00-07:00", "2026-09-02T18:00:00-07:00"),
      }),
    ).toBeNull();
    expect(
      branchTimeReview({
        local: { branchKey: "WE", ...local },
        google: google("2026-09-02T17:00:00-07:00", "2026-09-02T18:00:00-07:00", {
          recurringEventId: "parent",
          recurrence: null,
        }),
      }),
    ).toBeNull();
  });

  it("omits shared times from the patch while keeping Google-owned text", () => {
    const patch = seriesPatchFromGoogle({
      local: { title: "Swim", memberCount: 2, branchKey: "WE" },
      branchInitials: ["M"],
      google: google("2026-09-02T17:00:00-07:00", "2026-09-02T18:00:00-07:00", {
        location: "Pool",
      }),
      omitTimes: true,
    });
    expect(patch["start_at"]).toBeUndefined();
    expect(patch["end_at"]).toBeUndefined();
    expect(patch["all_day"]).toBeUndefined();
    expect(patch["location"]).toBe("Pool");
    expect(patch["title"]).toBe("Swim");
  });
});
