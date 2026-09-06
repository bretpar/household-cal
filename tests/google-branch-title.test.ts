import { describe, expect, it } from "vitest";

import {
  BRANCH_TITLE_REVIEW_MESSAGE,
  branchTitleReview,
  seriesPatchFromGoogle,
} from "../src/lib/google/mapping";

/**
 * Inbound Google title edits on one branch of a per-person weekday series must
 * not contaminate the shared local `events.title`. See QA-T5: Dad = Monday,
 * Mom = Wednesday; renaming only Mom's "WE" series must leave the shared title
 * and Dad's branch untouched and flag Mom's link for review.
 */
describe("branch title review", () => {
  const local = { branchKey: "WE", title: "QA-T5-BRANCH-TITLE-202809041600" };

  it("flags a Mom-branch-only rename and leaves the shared title unchanged", () => {
    const google = {
      id: "mom-branch",
      summary: "QA-T5-BRANCH-MOM-RENAMED-202809041600 - M",
      etag: '"m2"',
      updated: "2026-09-05T00:00:00.000Z",
    };
    expect(branchTitleReview({ local, branchInitials: ["M"], google })).toBe(
      BRANCH_TITLE_REVIEW_MESSAGE,
    );

    // with the review flag set, the series patch keeps the shared local title
    const patch = seriesPatchFromGoogle({
      local: { title: local.title, memberCount: 2, branchKey: "WE" },
      branchInitials: ["M"],
      google,
      omitTitle: true,
    });
    expect(patch["title"]).toBeUndefined();
    expect(patch["last_change_source"]).toBe("google");
  });

  it("flags the symmetric Dad-branch-only rename", () => {
    const review = branchTitleReview({
      local: { branchKey: "MO", title: "QA-T5-BRANCH-TITLE-202809041600" },
      branchInitials: ["D"],
      google: { id: "dad-branch", summary: "QA-T5-DAD-RENAMED - D" },
    });
    expect(review).toBe(BRANCH_TITLE_REVIEW_MESSAGE);
  });

  it("ignores a branch title that still matches the shared local title", () => {
    expect(
      branchTitleReview({
        local,
        branchInitials: ["M"],
        google: { id: "mom-branch", summary: "QA-T5-BRANCH-TITLE-202809041600 - M" },
      }),
    ).toBeNull();
  });

  it("is stable across a repeated sync of the same renamed branch", () => {
    const google = { id: "mom-branch", summary: "QA-T5-BRANCH-MOM-RENAMED-202809041600 - M" };
    expect(branchTitleReview({ local, branchInitials: ["M"], google })).toBe(
      branchTitleReview({ local, branchInitials: ["M"], google }),
    );
  });

  it("ignores detached single-occurrence exceptions (they own their title)", () => {
    expect(
      branchTitleReview({
        local,
        branchInitials: ["M"],
        google: {
          id: "occ1",
          summary: "Late pickup",
          recurringEventId: "mom-branch",
          originalStartTime: { dateTime: "2026-09-09T16:00:00.000Z" },
        },
      }),
    ).toBeNull();
  });

  it("lets a single-series shared event take a Google title rename normally", () => {
    expect(
      branchTitleReview({
        local: { branchKey: "", title: "Old title" },
        branchInitials: ["B", "E"],
        google: { id: "series1", summary: "New title - B & E" },
      }),
    ).toBeNull();
    const patch = seriesPatchFromGoogle({
      local: { title: "Old title", memberCount: 2, branchKey: "" },
      branchInitials: ["B", "E"],
      google: { id: "series1", summary: "New title - B & E" },
    });
    expect(patch["title"]).toBe("New title");
  });
});
