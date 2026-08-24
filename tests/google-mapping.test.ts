import { describe, expect, it } from "vitest";

import {
  computeBranches,
  exceptionEventFields,
  fromGoogleRecurrence,
  googleTitle,
  seriesPatchFromGoogle,
  shouldApplyGoogleChange,
  stripGeneratedSuffix,
  syncWindow,
  toGoogleRecurrence,
} from "../src/lib/google/mapping";
import {
  draftFromFormState,
  ruleForFormState,
  validateFormState,
} from "../src/components/EventForm";
import type { WeekdayCode } from "../src/lib/family-data";

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
    const lines = toGoogleRecurrence("FREQ=WEEKLY", ["TU", "TH"], "2026-12-14", []);
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

describe("inbound Google edit of an already-pushed app event", () => {
  const link = {
    google_etag: '"pushed"',
    google_updated_at: "2026-08-24T18:00:00.000Z",
    last_source: "app" as const,
    last_pushed_at: "2026-08-24T18:00:00.000Z",
  };

  it("applies a newer external edit even though the app pushed last", () => {
    expect(
      shouldApplyGoogleChange(
        link,
        { etag: '"external"', updated: "2026-08-24T19:30:00.000Z" },
        { updated_at: "2026-08-24T17:59:00.000Z", last_change_source: "app" },
      ),
    ).toBe(true);
  });

  it("still ignores the echo of our own push", () => {
    expect(
      shouldApplyGoogleChange(
        link,
        { etag: '"pushed"', updated: "2026-08-24T19:30:00.000Z" },
        { updated_at: "2026-08-24T17:59:00.000Z", last_change_source: "app" },
      ),
    ).toBe(false);
  });

  it("still ignores a Google update older than the one already processed", () => {
    expect(
      shouldApplyGoogleChange(
        link,
        { etag: '"old"', updated: "2026-08-24T17:00:00.000Z" },
        { updated_at: "2026-08-24T17:59:00.000Z", last_change_source: "app" },
      ),
    ).toBe(false);
  });

  it("lets a genuinely unsynced local app edit win", () => {
    expect(
      shouldApplyGoogleChange(
        link,
        { etag: '"external"', updated: "2026-08-24T18:30:00.000Z" },
        { updated_at: "2026-08-24T19:00:00.000Z", last_change_source: "app" },
      ),
    ).toBe(false);
  });

  it("does not let a google-sourced local change block an inbound edit", () => {
    expect(
      shouldApplyGoogleChange(
        link,
        { etag: '"external"', updated: "2026-08-24T18:30:00.000Z" },
        { updated_at: "2026-08-24T19:00:00.000Z", last_change_source: "google" },
      ),
    ).toBe(true);
  });

  it("maps an externally edited title back to the local title", () => {
    expect(stripGeneratedSuffix("New Test - E & B", ["E", "B"])).toBe("New Test");
  });
});

describe("google-edited single occurrence of an app series", () => {
  const g = {
    id: "occ1",
    summary: "QA recurring event - B",
    recurringEventId: "series1",
    start: { dateTime: "2026-08-31T19:30:00.000Z" },
    end: { dateTime: "2026-08-31T20:00:00.000Z" },
    originalStartTime: { dateTime: "2026-08-31T17:00:00.000Z" },
    etag: '"x"',
    updated: "2026-08-24T20:00:00.000Z",
  };

  it("inherits the branch member and strips the generated suffix", () => {
    const fields = exceptionEventFields({
      parent: { title: "QA recurring event", event_type: "other" },
      branch: { key: "", weekdays: null, memberIds: ["b"] },
      branchInitials: ["B"],
      google: g,
    });
    expect(fields.title).toBe("QA recurring event");
    expect(fields.member_ids).toEqual(["b"]);
    expect(fields.needs_family_assignment).toBe(false);
    expect(fields.start_at).toBe("2026-08-31T19:30:00.000Z");
    expect(fields.all_day).toBe(false);
  });

  it("inherits both members of a B & E branch", () => {
    const fields = exceptionEventFields({
      parent: { title: "School", event_type: "school" },
      branch: { key: "TU,WE,TH", weekdays: ["TU", "WE", "TH"], memberIds: ["b", "e"] },
      branchInitials: ["B", "E"],
      google: { ...g, summary: "School - B & E" },
    });
    expect(fields.title).toBe("School");
    expect(fields.member_ids).toEqual(["b", "e"]);
    expect(fields.event_type).toBe("school");
    expect(fields.needs_family_assignment).toBe(false);
  });

  it("keeps an externally renamed occurrence title as-is", () => {
    const fields = exceptionEventFields({
      parent: { title: "QA recurring event", event_type: "other" },
      branch: { key: "", weekdays: null, memberIds: ["b"] },
      branchInitials: ["B"],
      google: { ...g, summary: "Late pickup" },
    });
    expect(fields.title).toBe("Late pickup");
    expect(fields.member_ids).toEqual(["b"]);
  });

  it("flags assignment only when the branch has no members", () => {
    const fields = exceptionEventFields({
      parent: { title: "Anything", event_type: "other" },
      branch: { key: "", weekdays: null, memberIds: [] },
      branchInitials: [],
      google: g,
    });
    expect(fields.needs_family_assignment).toBe(true);
  });
});

describe("School per-person branches end to end", () => {
  const state = {
    title: "School",
    date: "2026-08-31",
    startTime: "08:00",
    endTime: "15:00",
    allDay: false,
    members: ["b", "e"],
    eventType: "school" as const,
    recurrence: "custom",
    recurrenceEnd: "never" as const,
    recurrenceUntil: "",
    recurrenceCount: 10,
    customizeDays: false,
    memberWeekdays: {
      b: ["MO", "TU", "WE", "TH"] as WeekdayCode[],
      e: ["TU", "WE", "TH"] as WeekdayCode[],
    },
    location: "",
    notes: "",
    calendarSourceId: null,
  };

  it("stores a real weekly rule for the custom schedule", () => {
    expect(ruleForFormState(state)).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH");
    expect(validateFormState(state)).toBeNull();
  });

  it("persists per-person days even when the toggle was never touched", () => {
    const draft = draftFromFormState(state);
    expect(draft.recurrence_rule).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH");
    expect(draft.member_weekdays).toEqual({
      b: ["MO", "TU", "WE", "TH"],
      e: ["TU", "WE", "TH"],
    });
  });

  it("produces exactly Mon=B, Tue-Thu=B+E and no Friday", () => {
    const draft = draftFromFormState(state);
    const branches = computeBranches({
      recurrence_rule: draft.recurrence_rule,
      participants: [
        { member_id: "b", weekdays: draft.member_weekdays!["b"] as WeekdayCode[] },
        { member_id: "e", weekdays: draft.member_weekdays!["e"] as WeekdayCode[] },
      ],
      member_ids: ["b", "e"],
    });
    expect(branches).toEqual([
      { key: "MO", weekdays: ["MO"], memberIds: ["b"] },
      { key: "TU,WE,TH", weekdays: ["TU", "WE", "TH"], memberIds: ["b", "e"] },
    ]);
    const titles = branches.map((br) =>
      googleTitle("School", br.memberIds.map((m) => (m === "b" ? "B" : "E"))),
    );
    expect(titles).toEqual(["School - B", "School - B & E"]);
    const lines = branches.map((br) =>
      toGoogleRecurrence(draft.recurrence_rule, br.weekdays, null, [])?.[0],
    );
    expect(lines).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO", "RRULE:FREQ=WEEKLY;BYDAY=TU,WE,TH"]);
    expect(lines.join(" ")).not.toContain("FRI");
    expect(lines.join(" ")).not.toContain("CUSTOM");
  });

  it("is deterministic across repeated computation (no extra branches)", () => {
    const draft = draftFromFormState(state);
    const compute = () =>
      computeBranches({
        recurrence_rule: draft.recurrence_rule,
        participants: [
          { member_id: "b", weekdays: ["MO", "TU", "WE", "TH"] },
          { member_id: "e", weekdays: ["TU", "WE", "TH"] },
        ],
        member_ids: ["b", "e"],
      });
    expect(compute()).toEqual(compute());
    expect(compute()).toHaveLength(2);
  });
});

describe("Google whole-series edit preserves app-owned data", () => {
  const google = {
    id: "series1",
    summary: "Baseball Practice - E & J",
    start: { dateTime: "2026-08-26T19:00:00.000Z" },
    end: { dateTime: "2026-08-26T20:00:00.000Z" },
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
    etag: '"e1"',
    updated: "2026-08-24T21:45:59.703Z",
  };

  it("updates the time and strips the generated suffix", () => {
    const patch = seriesPatchFromGoogle({
      local: { title: "Baseball Practice", memberCount: 2, branchKey: "" },
      branchInitials: ["E", "J"],
      google,
    });
    expect(patch["title"]).toBe("Baseball Practice");
    expect(patch["start_at"]).toBe("2026-08-26T19:00:00.000Z");
    expect(patch["last_change_source"]).toBe("google");
  });

  it("never touches members, weekdays or event type", () => {
    const patch = seriesPatchFromGoogle({
      local: { title: "Baseball Practice", memberCount: 2, branchKey: "" },
      branchInitials: ["E", "J"],
      google,
    });
    for (const key of ["member_ids", "event_members", "member_weekdays", "event_type", "family_id"]) {
      expect(patch).not.toHaveProperty(key);
    }
    expect(patch["needs_family_assignment"]).toBe(false);
  });

  it("keeps a B-only branch and a B+E branch intact", () => {
    const b = seriesPatchFromGoogle({
      local: { title: "School", memberCount: 1, branchKey: "MO" },
      branchInitials: ["B"],
      google: { ...google, summary: "School - B" },
    });
    expect(b["title"]).toBe("School");
    expect(b).not.toHaveProperty("member_ids");
    // a branch must not rewrite the shared recurrence rule
    expect(b).not.toHaveProperty("recurrence_rule");

    const be = seriesPatchFromGoogle({
      local: { title: "School", memberCount: 2, branchKey: "TU,WE,TH" },
      branchInitials: ["B", "E"],
      google: { ...google, summary: "School - B & E" },
    });
    expect(be["title"]).toBe("School");
    expect(be).not.toHaveProperty("member_ids");
  });

  it("applies a genuine external rename without altering assignments", () => {
    const patch = seriesPatchFromGoogle({
      local: { title: "Baseball Practice", memberCount: 2, branchKey: "" },
      branchInitials: ["E", "J"],
      google: { ...google, summary: "Baseball Practice (new field)" },
    });
    expect(patch["title"]).toBe("Baseball Practice (new field)");
    expect(patch).not.toHaveProperty("member_ids");
    expect(patch["needs_family_assignment"]).toBe(false);
  });

  it("is idempotent across repeated reconciliation", () => {
    const once = seriesPatchFromGoogle({
      local: { title: "Baseball Practice", memberCount: 2, branchKey: "" },
      branchInitials: ["E", "J"],
      google,
    });
    const twice = seriesPatchFromGoogle({
      local: { title: once["title"] as string, memberCount: 2, branchKey: "" },
      branchInitials: ["E", "J"],
      google,
    });
    expect(twice).toEqual(once);
  });

  it("still flags a truly memberless linked series", () => {
    const patch = seriesPatchFromGoogle({
      local: { title: "Trash day", memberCount: 0, branchKey: "" },
      branchInitials: [],
      google: { ...google, summary: "Trash day" },
    });
    expect(patch).not.toHaveProperty("needs_family_assignment");
  });
});
